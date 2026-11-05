create type public.payment_method as enum (
  'cash', 'mobile_money', 'card', 'bank_transfer'
);

alter table public.orders
  add column if not exists amount_paid numeric(14, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_amount_paid_check'
  ) then
    alter table public.orders
      add constraint orders_amount_paid_check check (amount_paid >= 0);
  end if;
end;
$$;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  idempotency_key uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  method public.payment_method not null,
  reference text check (reference is null or char_length(reference) <= 100),
  received_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete restrict
);

create index payments_order_idx on public.payments (order_id);
create index payments_business_created_idx
  on public.payments (business_id, created_at desc);

-- A non-cash reference (for example a mobile money transaction ID) can be used once per business.
create unique index payments_business_method_reference_idx
  on public.payments (business_id, method, lower(reference))
  where reference is not null and method <> 'cash';

create or replace function public.record_payment(
  p_business_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
  v_reference text := nullif(btrim(p_reference), '');
  v_due numeric(14, 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'payments.manage') then
    raise exception 'Payment management permission required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_amount is null or p_amount <= 0
    or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <> round(p_amount, 2)
    or p_method is null
    or char_length(coalesce(v_reference, '')) > 100
    or (p_method <> 'cash' and v_reference is null)
  then
    raise exception 'Enter a valid amount; non-cash payments need a reference'
      using errcode = '22023';
  end if;

  select * into v_existing
    from public.payments
    where business_id = p_business_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.order_id <> p_order_id or v_existing.amount <> p_amount
      or v_existing.method <> p_method
      or v_existing.reference is distinct from v_reference
    then
      raise exception 'Idempotency key was already used for a different payment'
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

  insert into public.payments (
    business_id, order_id, idempotency_key, amount, method, reference, received_by
  ) values (
    p_business_id, p_order_id, p_idempotency_key, p_amount, p_method,
    v_reference, auth.uid()
  ) returning id into v_payment_id;

  update public.orders
    set amount_paid = amount_paid + p_amount
    where id = p_order_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'payment.recorded', 'payment',
    v_payment_id::text,
    jsonb_build_object('order_id', p_order_id, 'amount', p_amount,
      'method', p_method::text)
  );

  return v_payment_id;
end;
$$;

alter table public.payments enable row level security;

drop policy if exists "Cashiers read business payments" on public.payments;
create policy "Cashiers read business payments"
  on public.payments for select to authenticated
  using ((select public.has_business_permission(business_id, 'payments.manage')));

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

revoke all on function public.record_payment(
  uuid, uuid, uuid, numeric, public.payment_method, text
) from public, anon;
grant execute on function public.record_payment(
  uuid, uuid, uuid, numeric, public.payment_method, text
) to authenticated;
