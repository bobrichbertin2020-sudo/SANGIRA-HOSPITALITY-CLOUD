-- Cashier controls: pay-before / pay-after setting and end-of-shift cash close-out.

alter table public.business_settings
  add column if not exists payment_timing text not null default 'after'
  check (payment_timing in ('before', 'after'));

-- When a business requires payment first, a ticket cannot be started until the
-- order's non-cancelled items are fully paid.
create or replace function public.enforce_prepay_before_preparing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timing text;
  v_total numeric(14, 2);
  v_paid numeric(14, 2);
begin
  if new.status = 'preparing' and old.status = 'pending' then
    select s.payment_timing into v_timing
      from public.business_settings s
      where s.business_id = new.business_id;

    if v_timing = 'before' then
      select coalesce(sum(i.unit_price * i.quantity), 0) into v_total
        from public.order_items i
        where i.order_id = new.order_id and i.status <> 'cancelled';
      select o.amount_paid into v_paid
        from public.orders o
        where o.id = new.order_id and o.business_id = new.business_id;

      if coalesce(v_paid, 0) < v_total then
        raise exception 'This order must be paid before preparation can start.'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_prepay_check on public.order_items;
create trigger order_items_prepay_check
  before update of status on public.order_items
  for each row execute function public.enforce_prepay_before_preparing();

create or replace function public.set_payment_timing(
  p_business_id uuid,
  p_timing text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'business.manage') then
    raise exception 'Business management permission required' using errcode = '42501';
  end if;
  if p_timing not in ('before', 'after') then
    raise exception 'Invalid payment timing' using errcode = '22023';
  end if;

  update public.business_settings
    set payment_timing = p_timing
    where business_id = p_business_id;

  if not found then
    raise exception 'Business settings not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'business.payment_timing', 'business',
    p_business_id::text, jsonb_build_object('timing', p_timing)
  );
end;
$$;

revoke all on function public.set_payment_timing(uuid, text) from public, anon;
grant execute on function public.set_payment_timing(uuid, text) to authenticated;

create table if not exists public.cashier_closeouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  cashier_id uuid not null references auth.users (id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null default now(),
  expected_cash numeric(14, 2) not null,
  counted_cash numeric(14, 2) not null check (counted_cash >= 0),
  variance numeric(14, 2) not null,
  non_cash_total numeric(14, 2) not null default 0,
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists cashier_closeouts_business_idx
  on public.cashier_closeouts (business_id, created_at desc);

alter table public.cashier_closeouts enable row level security;

drop policy if exists "Cashiers read closeouts" on public.cashier_closeouts;
create policy "Cashiers read closeouts"
  on public.cashier_closeouts for select to authenticated
  using ((select public.has_business_permission(business_id, 'payments.manage')));

revoke all on public.cashier_closeouts from anon, authenticated;
grant select on public.cashier_closeouts to authenticated;

-- Expected cash is what this cashier took in cash, minus cash refunds, since
-- their previous close-out. The variance is stored so shortages stay visible.
create or replace function public.cashier_shift_summary(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_cash numeric(14, 2);
  v_refunds numeric(14, 2);
  v_non_cash numeric(14, 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'payments.manage') then
    raise exception 'Payment management permission required' using errcode = '42501';
  end if;

  select coalesce(max(c.period_end), '-infinity'::timestamptz) into v_start
    from public.cashier_closeouts c
    where c.business_id = p_business_id and c.cashier_id = auth.uid();

  select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method <> 'cash'), 0)
    into v_cash, v_non_cash
    from public.payments p
    where p.business_id = p_business_id and p.received_by = auth.uid()
      and p.created_at > v_start;

  select coalesce(sum(r.amount), 0) into v_refunds
    from public.refunds r
    where r.business_id = p_business_id and r.refunded_by = auth.uid()
      and r.method = 'cash' and r.created_at > v_start;

  return jsonb_build_object(
    'period_start', case when v_start = '-infinity'::timestamptz then null else v_start end,
    'cash_received', v_cash,
    'cash_refunded', v_refunds,
    'expected_cash', v_cash - v_refunds,
    'non_cash_total', v_non_cash
  );
end;
$$;

create or replace function public.close_cashier_shift(
  p_business_id uuid,
  p_counted numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_start timestamptz;
  v_expected numeric(14, 2);
  v_notes text := nullif(btrim(p_notes), '');
  v_id uuid;
begin
  if p_counted is null or p_counted < 0 or p_counted <> round(p_counted, 2)
    or char_length(coalesce(v_notes, '')) > 300
  then
    raise exception 'Enter the cash counted in the drawer' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || coalesce(auth.uid()::text, ''), 0)
  );

  v_summary := public.cashier_shift_summary(p_business_id);
  v_expected := (v_summary ->> 'expected_cash')::numeric;
  v_start := coalesce((v_summary ->> 'period_start')::timestamptz, '-infinity'::timestamptz);

  if v_start = '-infinity'::timestamptz then
    select coalesce(min(p.created_at), now()) into v_start
      from public.payments p
      where p.business_id = p_business_id and p.received_by = auth.uid();
  end if;

  if p_counted <> v_expected and v_notes is null then
    raise exception 'Explain the difference in the notes' using errcode = '22023';
  end if;

  insert into public.cashier_closeouts (
    business_id, cashier_id, period_start, expected_cash, counted_cash,
    variance, non_cash_total, notes
  ) values (
    p_business_id, auth.uid(), v_start, v_expected, p_counted,
    p_counted - v_expected, (v_summary ->> 'non_cash_total')::numeric, v_notes
  ) returning id into v_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'cashier.closeout', 'cashier_closeout',
    v_id::text,
    jsonb_build_object('expected', v_expected, 'counted', p_counted,
      'variance', p_counted - v_expected)
  );

  return v_id;
end;
$$;

revoke all on function public.cashier_shift_summary(uuid) from public, anon;
grant execute on function public.cashier_shift_summary(uuid) to authenticated;
revoke all on function public.close_cashier_shift(uuid, numeric, text) from public, anon;
grant execute on function public.close_cashier_shift(uuid, numeric, text) to authenticated;
