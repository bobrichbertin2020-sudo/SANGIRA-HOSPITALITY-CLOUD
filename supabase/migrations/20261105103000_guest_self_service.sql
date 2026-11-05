-- Guest self-service: cancel an order before the kitchen/bar starts it, and
-- call a server or ask for the bill. Staff see and resolve open requests.

create type public.service_request_type as enum ('call_waiter', 'request_bill');
create type public.service_request_status as enum ('open', 'resolved');

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  table_session_id uuid not null references public.table_sessions (id) on delete restrict,
  table_label text not null check (char_length(table_label) between 1 and 20),
  request_type public.service_request_type not null,
  status public.service_request_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create unique index service_requests_one_open_per_session_type
  on public.service_requests (table_session_id, request_type)
  where status = 'open';
create index service_requests_open_idx
  on public.service_requests (business_id, created_at desc)
  where status = 'open';

alter table public.service_requests enable row level security;

create policy "Service staff read requests"
  on public.service_requests for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'service.confirm'))
    or (select public.has_business_permission(business_id, 'orders.manage'))
    or (select public.has_business_permission(business_id, 'payments.manage'))
  );

revoke all on public.service_requests from anon, authenticated;
grant select on public.service_requests to authenticated;

create or replace function public.create_service_request(
  p_session_id uuid,
  p_nonce_hash text,
  p_type public.service_request_type
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  v_session := public.qr_verify_session(p_session_id, p_nonce_hash);

  perform public.qr_check_rate(
    'service_request', v_session.id::text, 10, interval '1 hour'
  );

  if p_type = 'request_bill' and not exists (
    select 1 from public.orders o
    where o.table_session_id = v_session.id and o.status <> 'cancelled'
  ) then
    raise exception 'Place an order before asking for the bill.'
      using errcode = '22023';
  end if;

  insert into public.service_requests (
    business_id, table_session_id, table_label, request_type
  ) values (
    v_session.business_id, v_session.id, v_session.table_label, p_type
  )
  on conflict (table_session_id, request_type) where status = 'open'
  do nothing;
end;
$$;

create or replace function public.customer_open_requests(
  p_session_id uuid,
  p_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  v_session := public.qr_verify_session(p_session_id, p_nonce_hash);

  return coalesce((
    select jsonb_agg(r.request_type::text)
    from public.service_requests r
    where r.table_session_id = v_session.id and r.status = 'open'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cancel_customer_order(
  p_session_id uuid,
  p_nonce_hash text,
  p_order_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_order public.orders%rowtype;
begin
  v_session := public.qr_verify_session(p_session_id, p_nonce_hash);

  select * into v_order
    from public.orders
    where table_session_id = v_session.id
      and order_code = p_order_code
    for update;

  if not found then
    raise exception 'Order not found' using errcode = '22023';
  end if;

  -- Once the kitchen or bar has started any item, only staff can cancel.
  if exists (
    select 1 from public.order_items i
    where i.order_id = v_order.id and i.status not in ('pending', 'cancelled')
  ) or v_order.status = 'cancelled' then
    raise exception 'This order has already been started. Please ask a member of staff.'
      using errcode = '22023';
  end if;

  update public.order_items
    set status = 'cancelled'
    where order_id = v_order.id;

  update public.orders
    set status = 'cancelled'
    where id = v_order.id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_order.business_id, null, 'order.cancelled_by_guest', 'order',
    v_order.id::text,
    jsonb_build_object('order_code', v_order.order_code,
      'table', v_order.table_label)
  );
end;
$$;

create or replace function public.resolve_service_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.service_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_request
    from public.service_requests
    where id = p_request_id
    for update;

  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  if not (
    public.has_business_permission(v_request.business_id, 'service.confirm')
    or public.has_business_permission(v_request.business_id, 'orders.manage')
    or public.has_business_permission(v_request.business_id, 'payments.manage')
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update public.service_requests
    set status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id and status = 'open';
end;
$$;

revoke all on function public.create_service_request(uuid, text, public.service_request_type)
  from public, anon, authenticated;
revoke all on function public.customer_open_requests(uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_customer_order(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.resolve_service_request(uuid) from public, anon;
grant execute on function public.resolve_service_request(uuid) to authenticated;
