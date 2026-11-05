-- Manager overview: one read-only snapshot of the business for opening the day
-- and for live monitoring. Day boundaries follow the business time zone.

create or replace function public.manager_overview(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today timestamptz;
  v_yesterday timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'reports.view') then
    raise exception 'Not allowed to view the overview' using errcode = '42501';
  end if;

  select coalesce(
           (select s.timezone from public.business_settings s
            where s.business_id = p_business_id), 'UTC')
    into v_tz;
  if v_tz is null or not exists (
    select 1 from pg_timezone_names where name = v_tz
  ) then
    v_tz := 'UTC';
  end if;

  v_today := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_yesterday := v_today - interval '1 day';

  select jsonb_build_object(
    'timezone', v_tz,
    'revenue_today', (
      select coalesce(sum(x.amount), 0) from (
        select p.amount from public.payments p
          where p.business_id = p_business_id and p.created_at >= v_today
        union all
        select -r.amount from public.refunds r
          where r.business_id = p_business_id and r.created_at >= v_today
      ) x
    ),
    'revenue_yesterday', (
      select coalesce(sum(x.amount), 0) from (
        select p.amount from public.payments p
          where p.business_id = p_business_id
            and p.created_at >= v_yesterday and p.created_at < v_today
        union all
        select -r.amount from public.refunds r
          where r.business_id = p_business_id
            and r.created_at >= v_yesterday and r.created_at < v_today
      ) x
    ),
    'orders_today', (
      select count(*) from public.orders o
        where o.business_id = p_business_id and o.created_at >= v_today
          and o.status <> 'cancelled'
    ),
    'cancelled_items_today', (
      select count(*) from public.order_items i
        where i.business_id = p_business_id and i.created_at >= v_today
          and i.status = 'cancelled'
    ),
    'unfinished_orders', (
      select count(*) from public.orders o
        where o.business_id = p_business_id
          and o.status in ('submitted', 'preparing', 'ready')
    ),
    'delayed_items', (
      select count(*) from public.order_items i
        where i.business_id = p_business_id
          and i.status in ('pending', 'preparing')
          and i.created_at < now() - interval '20 minutes'
    ),
    'unpaid', (
      select jsonb_build_object('orders', count(*), 'amount', coalesce(sum(u.due), 0))
      from (
        select o.id,
               coalesce(sum(i.unit_price * i.quantity)
                 filter (where i.status <> 'cancelled'), 0) - o.amount_paid as due
        from public.orders o
        left join public.order_items i
          on i.order_id = o.id and i.business_id = o.business_id
        where o.business_id = p_business_id and o.status <> 'cancelled'
        group by o.id, o.amount_paid
      ) u
      where u.due > 0
    ),
    'refunds_due', (
      select jsonb_build_object('orders', count(*), 'amount', coalesce(sum(u.owed), 0))
      from (
        select o.id,
               o.amount_paid - coalesce(sum(i.unit_price * i.quantity)
                 filter (where i.status <> 'cancelled'), 0) as owed
        from public.orders o
        left join public.order_items i
          on i.order_id = o.id and i.business_id = o.business_id
        where o.business_id = p_business_id and o.amount_paid > 0
        group by o.id, o.amount_paid
      ) u
      where u.owed > 0
    ),
    'open_guest_requests', (
      select count(*) from public.service_requests r
        where r.business_id = p_business_id and r.status = 'open'
    ),
    'pending_stock_requests', (
      select count(*) from public.stock_requests r
        where r.business_id = p_business_id
          and r.status in ('submitted', 'approved', 'partially_approved')
    ),
    'pending_purchase_approvals', (
      select count(*) from public.purchase_orders po
        where po.business_id = p_business_id and po.status = 'pending_approval'
    ),
    'awaiting_delivery', (
      select count(*) from public.purchase_orders po
        where po.business_id = p_business_id
          and po.status in ('approved', 'partially_received')
    ),
    'low_stock_count', (
      select count(*) from (
        select si.id
        from public.stock_items si
        where si.business_id = p_business_id and si.is_active
          and si.minimum_quantity > 0
          and coalesce((
            select sum(b.quantity) from public.stock_balances b
            where b.stock_item_id = si.id and b.business_id = si.business_id
          ), 0) <= si.minimum_quantity
      ) l
    ),
    'expiring_soon_count', (
      select count(*) from public.stock_batches sb
        where sb.business_id = p_business_id and sb.remaining_quantity > 0
          and sb.expires_at is not null and sb.expires_at <= current_date + 7
    ),
    'staff_on_duty', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(pr.full_name, 'Staff member'),
        'since', a.clock_in_at) order by a.clock_in_at), '[]'::jsonb)
      from public.attendance_records a
      left join public.profiles pr on pr.user_id = a.user_id
      where a.business_id = p_business_id and a.clock_out_at is null
    ),
    'closeouts_today', (
      select count(*) from public.cashier_closeouts c
        where c.business_id = p_business_id and c.created_at >= v_today
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.manager_overview(uuid) from public, anon;
grant execute on function public.manager_overview(uuid) to authenticated;
