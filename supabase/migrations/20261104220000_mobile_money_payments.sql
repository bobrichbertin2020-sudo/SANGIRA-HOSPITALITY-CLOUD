-- Mobile money (MTN MoMo, Airtel Money) collection requests.
-- Money is only recorded in public.payments after the provider status API confirms success.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type public.payment_provider as enum ('mtn_momo', 'airtel_money');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_request_status') then
    create type public.payment_request_status as enum (
      'pending', 'succeeded', 'failed'
    );
  end if;
end;
$$;

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  provider public.payment_provider not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  msisdn_last4 text not null check (msisdn_last4 ~ '^[0-9]{4}$'),
  status public.payment_request_status not null default 'pending',
  provider_txn_id text check (provider_txn_id is null or char_length(provider_txn_id) <= 100),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 300),
  idempotency_key uuid not null,
  initiated_by uuid not null references auth.users (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (business_id, idempotency_key),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete restrict
);

create index if not exists payment_requests_business_created_idx
  on public.payment_requests (business_id, created_at desc);
create index if not exists payment_requests_order_idx
  on public.payment_requests (order_id);

-- Only one in-flight collection per order.
create unique index if not exists payment_requests_one_pending_idx
  on public.payment_requests (order_id) where status = 'pending';

create table if not exists public.payment_provider_events (
  id bigint generated always as identity primary key,
  payment_request_id uuid not null references public.payment_requests (id) on delete cascade,
  source text not null check (source in ('initiate', 'callback', 'poll')),
  provider_status text check (provider_status is null or char_length(provider_status) <= 100),
  created_at timestamptz not null default now()
);

create index if not exists payment_provider_events_request_idx
  on public.payment_provider_events (payment_request_id, created_at desc);

drop trigger if exists payment_requests_set_updated_at on public.payment_requests;
create trigger payment_requests_set_updated_at
  before update on public.payment_requests
  for each row execute function public.set_updated_at();

alter table public.payment_requests enable row level security;
alter table public.payment_provider_events enable row level security;

drop policy if exists "Cashiers read payment requests" on public.payment_requests;
create policy "Cashiers read payment requests"
  on public.payment_requests for select to authenticated
  using ((select public.has_business_permission(business_id, 'payments.manage')));

revoke all on public.payment_requests from anon, authenticated;
revoke all on public.payment_provider_events from anon, authenticated;
grant select on public.payment_requests to authenticated;
grant select, update on public.payment_requests to service_role;
grant select, insert on public.payment_provider_events to service_role;

create or replace function public.create_payment_request(
  p_business_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_provider public.payment_provider,
  p_amount numeric,
  p_msisdn_last4 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.payment_requests%rowtype;
  v_id uuid;
  v_due numeric(14, 2);
  v_currency text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'payments.manage') then
    raise exception 'Payment management permission required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_provider is null or p_amount is null
    or p_amount <= 0 or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <> round(p_amount, 2)
    or p_msisdn_last4 is null or p_msisdn_last4 !~ '^[0-9]{4}$'
  then
    raise exception 'Invalid payment request' using errcode = '22023';
  end if;

  select * into v_existing
    from public.payment_requests
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.amount <> p_amount
      or v_existing.provider <> p_provider
    then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  select * into v_order
    from public.orders
    where id = p_order_id and business_id = p_business_id
    for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(i.unit_price * i.quantity), 0) - v_order.amount_paid
    into v_due
    from public.order_items i
    where i.order_id = p_order_id and i.status <> 'cancelled';

  if v_order.status = 'cancelled' or p_amount > v_due then
    raise exception 'Payment exceeds the amount due on this order'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.payment_requests
    where order_id = p_order_id and status = 'pending'
  ) then
    raise exception 'A mobile money request is already pending for this order'
      using errcode = '23505';
  end if;

  select currency_code into v_currency
    from public.business_settings where business_id = p_business_id;

  insert into public.payment_requests (
    business_id, order_id, provider, amount, currency, msisdn_last4,
    idempotency_key, initiated_by
  ) values (
    p_business_id, p_order_id, p_provider, p_amount, coalesce(v_currency, 'UGX'),
    p_msisdn_last4, p_idempotency_key, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'payment_request.created', 'payment_request',
    v_id::text,
    jsonb_build_object('order_id', p_order_id, 'amount', p_amount,
      'provider', p_provider::text)
  );

  return v_id;
end;
$$;

-- Server-only: confirmed by the provider status API.
create or replace function public.settle_payment_request(
  p_request_id uuid,
  p_provider_txn_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.payment_requests%rowtype;
  v_payment_id uuid;
  v_txn text := nullif(btrim(p_provider_txn_id), '');
begin
  select * into v_req
    from public.payment_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payment request not found' using errcode = 'P0002';
  end if;
  if v_req.status = 'succeeded' then
    return v_req.payment_id;
  end if;

  perform 1 from public.orders
    where id = v_req.order_id and business_id = v_req.business_id for update;

  -- Provider confirmed receipt, so the money is recorded even if the order changed meanwhile.
  insert into public.payments (
    business_id, order_id, idempotency_key, amount, method, reference, received_by
  ) values (
    v_req.business_id, v_req.order_id, v_req.id, v_req.amount, 'mobile_money',
    left(v_req.provider::text || ':' || coalesce(v_txn, v_req.id::text), 100),
    v_req.initiated_by
  ) returning id into v_payment_id;

  update public.orders
    set amount_paid = amount_paid + v_req.amount
    where id = v_req.order_id;

  update public.payment_requests
    set status = 'succeeded', provider_txn_id = left(v_txn, 100),
        payment_id = v_payment_id, settled_at = now(), failure_reason = null
    where id = v_req.id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_req.business_id, v_req.initiated_by, 'payment.recorded', 'payment',
    v_payment_id::text,
    jsonb_build_object('order_id', v_req.order_id, 'amount', v_req.amount,
      'method', 'mobile_money', 'provider', v_req.provider::text,
      'payment_request_id', v_req.id)
  );

  return v_payment_id;
end;
$$;

create or replace function public.fail_payment_request(
  p_request_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_requests
    set status = 'failed', failure_reason = left(nullif(btrim(p_reason), ''), 300)
    where id = p_request_id and status = 'pending';
$$;

revoke all on function public.create_payment_request(
  uuid, uuid, uuid, public.payment_provider, numeric, text
) from public, anon;
grant execute on function public.create_payment_request(
  uuid, uuid, uuid, public.payment_provider, numeric, text
) to authenticated;

revoke all on function public.settle_payment_request(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_payment_request(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_payment_request(uuid, text) to service_role;
grant execute on function public.fail_payment_request(uuid, text) to service_role;
