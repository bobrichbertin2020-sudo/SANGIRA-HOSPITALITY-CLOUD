-- Read-only business report. Aggregation happens in the database so that
-- staff with reports.view never need direct access to payment rows.

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
        select p.method::text as method, sum(p.amount) as total
        from public.payments p
        where p.business_id = p_business_id
          and p.created_at >= v_from and p.created_at < v_to
        group by p.method
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
