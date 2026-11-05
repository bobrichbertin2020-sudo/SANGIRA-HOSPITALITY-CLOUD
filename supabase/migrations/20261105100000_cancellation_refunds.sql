-- Cancellation stock return and refunds.
-- 1. Cancelling an order item after its ingredients were consumed returns them
--    to the preparing department's stock, with a ledger entry per ingredient.
-- 2. Refunds are recorded against an order. A refund may only return money paid
--    in excess of the value of the non-cancelled items, so cancelling items is
--    what creates a refundable balance.

alter type public.stock_movement_type add value if not exists 'consumption_reversal';

create unique index if not exists stock_movements_order_item_return_once
  on public.stock_movements (reference_id, stock_item_id)
  where reference_type = 'order_item_return';

create or replace function public.restore_order_item_stock(
  p_item_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items%rowtype;
  v_move record;
  v_qty numeric(14, 3);
  v_before numeric(14, 3);
begin
  select * into v_item
    from public.order_items
    where id = p_item_id
    for update;

  if not found or v_item.stock_consumed_at is null then
    return;
  end if;

  for v_move in
    select m.stock_item_id, m.stock_location_id, m.quantity_delta
    from public.stock_movements m
    where m.business_id = v_item.business_id
      and m.reference_type = 'order_item'
      and m.reference_id = v_item.id
      and m.movement_type = 'consumption'
    order by m.stock_item_id
  loop
    v_qty := abs(v_move.quantity_delta);

    select b.quantity into v_before
      from public.stock_balances b
      where b.stock_location_id = v_move.stock_location_id
        and b.stock_item_id = v_move.stock_item_id
        and b.business_id = v_item.business_id
      for update;

    if v_before is null then
      raise exception 'Stock balance for the returned ingredient was not found'
        using errcode = 'P0002';
    end if;

    update public.stock_balances
      set quantity = quantity + v_qty, updated_at = now()
      where stock_location_id = v_move.stock_location_id
        and stock_item_id = v_move.stock_item_id;

    -- The original batch is not tracked per order, so the returned quantity
    -- becomes its own batch without an expiry date.
    insert into public.stock_batches (
      business_id, receipt_id, stock_item_id, stock_location_id,
      batch_number, expires_at, initial_quantity, remaining_quantity
    ) values (
      v_item.business_id, null, v_move.stock_item_id, v_move.stock_location_id,
      'RETURN', null, v_qty, v_qty
    );

    insert into public.stock_movements (
      business_id, stock_item_id, stock_location_id, movement_type,
      quantity_delta, quantity_before, quantity_after,
      reference_type, reference_id, actor_user_id, reason
    ) values (
      v_item.business_id, v_move.stock_item_id, v_move.stock_location_id,
      'consumption_reversal', v_qty, v_before, v_before + v_qty,
      'order_item_return', v_item.id, p_actor,
      'Cancelled ' || v_item.order_code || ': ' || v_item.item_name
    );
  end loop;

  update public.order_items
    set stock_consumed_at = null
    where id = v_item.id;
end;
$$;

revoke all on function public.restore_order_item_stock(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.update_order_item_status(
  p_item_id uuid,
  p_status public.order_item_status
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items%rowtype;
  v_department_id uuid;
  v_can_prepare boolean;
  v_can_manage_orders boolean;
  v_order_status public.order_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_item
    from public.order_items
    where id = p_item_id
    for update;

  if not found then
    raise exception 'Order item not found' using errcode = 'P0002';
  end if;

  select d.id into v_department_id
    from public.departments d
    where d.business_id = v_item.business_id
      and d.department_key = v_item.department_key
      and d.is_enabled;

  v_can_prepare := v_department_id is not null and (
    public.has_department_permission(
      v_item.business_id, v_department_id, v_item.department_key || '.prepare'
    )
    or public.has_department_permission(
      v_item.business_id, v_department_id, v_item.department_key || '.manage'
    )
  );
  v_can_manage_orders := public.has_business_permission(
    v_item.business_id, 'orders.manage'
  );

  if not (
    (v_item.status = 'pending' and p_status = 'preparing' and v_can_prepare)
    or (v_item.status = 'preparing' and p_status = 'ready' and v_can_prepare)
    or (
      v_item.status = 'ready' and p_status = 'delivered'
      and public.has_business_permission(v_item.business_id, 'service.confirm')
    )
    or (
      v_item.status in ('pending', 'preparing') and p_status = 'cancelled'
      and (v_can_manage_orders or v_can_prepare)
    )
  ) then
    raise exception 'This status change is not allowed' using errcode = '42501';
  end if;

  if p_status = 'preparing' then
    perform public.consume_order_item_stock(p_item_id, auth.uid());
  elsif p_status = 'cancelled' then
    perform public.restore_order_item_stock(p_item_id, auth.uid());
  end if;

  update public.order_items
    set status = p_status, updated_by = auth.uid()
    where id = p_item_id;

  select case
    when not exists (
      select 1 from public.order_items i
      where i.order_id = v_item.order_id and i.status <> 'cancelled'
    ) then 'cancelled'
    when not exists (
      select 1 from public.order_items i
      where i.order_id = v_item.order_id
        and i.status not in ('cancelled', 'delivered')
    ) then 'served'
    when not exists (
      select 1 from public.order_items i
      where i.order_id = v_item.order_id
        and i.status not in ('cancelled', 'ready', 'delivered')
    ) then 'ready'
    when exists (
      select 1 from public.order_items i
      where i.order_id = v_item.order_id
        and i.status in ('preparing', 'ready', 'delivered')
    ) then 'preparing'
    else 'submitted'
  end::public.order_status
  into v_order_status;

  update public.orders
    set status = v_order_status
    where id = v_item.order_id and business_id = v_item.business_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_item.business_id, auth.uid(), 'order_item.' || p_status::text,
    'order_item', p_item_id::text,
    jsonb_build_object('order_id', v_item.order_id, 'from', v_item.status::text)
  );

  return v_order_status;
end;
$$;

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  idempotency_key uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  method public.payment_method not null,
  reference text check (reference is null or char_length(reference) <= 100),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  refunded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete restrict
);

create index if not exists refunds_order_idx on public.refunds (order_id);
create index if not exists refunds_business_created_idx
  on public.refunds (business_id, created_at desc);

create or replace function public.record_refund(
  p_business_id uuid,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reason text,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.refunds%rowtype;
  v_refund_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_reference text := nullif(btrim(p_reference), '');
  v_active numeric(14, 2);
  v_refundable numeric(14, 2);
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
    or char_length(coalesce(v_reason, '')) not between 3 and 300
    or char_length(coalesce(v_reference, '')) > 100
  then
    raise exception 'Enter a valid amount and a reason for the refund'
      using errcode = '22023';
  end if;

  select * into v_existing
    from public.refunds
    where business_id = p_business_id and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.order_id <> p_order_id or v_existing.amount <> p_amount
      or v_existing.method <> p_method
    then
      raise exception 'Idempotency key was already used for a different refund'
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

  select coalesce(sum(i.unit_price * i.quantity), 0)
    into v_active
    from public.order_items i
    where i.order_id = p_order_id and i.status <> 'cancelled';

  v_refundable := v_order.amount_paid - v_active;

  if p_amount > v_refundable then
    raise exception 'Refund exceeds the amount paid for cancelled items'
      using errcode = '22023';
  end if;

  insert into public.refunds (
    business_id, order_id, idempotency_key, amount, method, reference,
    reason, refunded_by
  ) values (
    p_business_id, p_order_id, p_idempotency_key, p_amount, p_method,
    v_reference, v_reason, auth.uid()
  ) returning id into v_refund_id;

  update public.orders
    set amount_paid = amount_paid - p_amount
    where id = p_order_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'refund.recorded', 'refund',
    v_refund_id::text,
    jsonb_build_object('order_id', p_order_id, 'amount', p_amount,
      'method', p_method::text, 'reason', v_reason)
  );

  return v_refund_id;
end;
$$;

alter table public.refunds enable row level security;

drop policy if exists "Cashiers read business refunds" on public.refunds;
create policy "Cashiers read business refunds"
  on public.refunds for select to authenticated
  using ((select public.has_business_permission(business_id, 'payments.manage')));

revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;

revoke all on function public.record_refund(
  uuid, uuid, uuid, numeric, public.payment_method, text, text
) from public, anon;
grant execute on function public.record_refund(
  uuid, uuid, uuid, numeric, public.payment_method, text, text
) to authenticated;

-- Reports show money collected net of refunds, per method.
create or replace function public.business_report(
  p_business_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_business_permission(p_business_id, 'reports.view') then
    raise exception 'Not allowed to view reports' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_to < p_from
     or p_to - p_from > 366 then
    raise exception 'Choose a valid date range of at most 366 days'
      using errcode = '22023';
  end if;

  v_from := p_from::timestamptz;
  v_to := (p_to + 1)::timestamptz;

  select jsonb_build_object(
    'sales', (
      select jsonb_build_object(
        'order_count', count(distinct i.order_id),
        'item_count', coalesce(sum(i.quantity), 0),
        'gross_sales', coalesce(sum(i.quantity * i.unit_price), 0)
      )
      from public.order_items i
      where i.business_id = p_business_id
        and i.status <> 'cancelled'
        and i.created_at >= v_from and i.created_at < v_to
    ),
    'payments_by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', m.method, 'total', m.total)
        order by m.method)
      from (
        select x.method, sum(x.amount) as total
        from (
          select p.method::text as method, p.amount
          from public.payments p
          where p.business_id = p_business_id
            and p.created_at >= v_from and p.created_at < v_to
          union all
          select r.method::text, -r.amount
          from public.refunds r
          where r.business_id = p_business_id
            and r.created_at >= v_from and r.created_at < v_to
        ) x
        group by x.method
      ) m
    ), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', t.item_name, 'quantity', t.qty, 'sales', t.sales)
        order by t.qty desc, t.item_name)
      from (
        select i.item_name, sum(i.quantity) as qty,
          sum(i.quantity * i.unit_price) as sales
        from public.order_items i
        where i.business_id = p_business_id
          and i.status <> 'cancelled'
          and i.created_at >= v_from and i.created_at < v_to
        group by i.item_name
        order by sum(i.quantity) desc, i.item_name
        limit 10
      ) t
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'unit', s.unit,
        'on_hand', s.on_hand, 'minimum', s.minimum_quantity)
        order by s.name)
      from (
        select si.name, si.unit, si.minimum_quantity,
          coalesce((
            select sum(b.quantity) from public.stock_balances b
            where b.stock_item_id = si.id and b.business_id = si.business_id
          ), 0) as on_hand
        from public.stock_items si
        where si.business_id = p_business_id and si.is_active
      ) s
      where s.on_hand <= s.minimum_quantity and s.minimum_quantity > 0
    ), '[]'::jsonb),
    'expiring_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', e.name, 'batch_number', e.batch_number,
        'expires_at', e.expires_at, 'remaining', e.remaining_quantity)
        order by e.expires_at, e.name)
      from (
        select si.name, sb.batch_number, sb.expires_at, sb.remaining_quantity
        from public.stock_batches sb
        join public.stock_items si
          on si.id = sb.stock_item_id and si.business_id = sb.business_id
        where sb.business_id = p_business_id
          and sb.remaining_quantity > 0
          and sb.expires_at is not null
          and sb.expires_at <= current_date + 14
        order by sb.expires_at, si.name
        limit 50
      ) e
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.business_report(uuid, date, date)
  from public, anon;
grant execute on function public.business_report(uuid, date, date)
  to authenticated;
