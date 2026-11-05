-- Kitchen and bar ticket handling: who is preparing a ticket, how long it has
-- been waiting, and manager take-over. The assignee is set automatically when
-- a ticket is started.

alter table public.order_items
  add column if not exists assigned_to uuid references auth.users (id) on delete set null,
  add column if not exists assigned_name text,
  add column if not exists started_at timestamptz,
  add column if not exists ready_at timestamptz;

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
  v_name text;
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
    select nullif(btrim(p.full_name), '') into v_name
      from public.profiles p where p.user_id = auth.uid();
    update public.order_items
      set assigned_to = auth.uid(),
          assigned_name = coalesce(v_name, 'Staff'),
          started_at = now()
      where id = p_item_id;
  elsif p_status = 'ready' then
    update public.order_items set ready_at = now() where id = p_item_id;
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

-- A department manager (or order manager) can take over a ticket that is
-- being prepared, for example when the original cook is unavailable.
create or replace function public.take_over_ticket(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items%rowtype;
  v_department_id uuid;
  v_name text;
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

  if not (
    public.has_business_permission(v_item.business_id, 'orders.manage')
    or (
      v_department_id is not null and public.has_department_permission(
        v_item.business_id, v_department_id, v_item.department_key || '.manage'
      )
    )
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if v_item.status <> 'preparing' then
    raise exception 'Only a ticket being prepared can be taken over'
      using errcode = '22023';
  end if;

  select nullif(btrim(p.full_name), '') into v_name
    from public.profiles p where p.user_id = auth.uid();

  update public.order_items
    set assigned_to = auth.uid(), assigned_name = coalesce(v_name, 'Staff')
    where id = p_item_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_item.business_id, auth.uid(), 'order_item.taken_over', 'order_item',
    p_item_id::text, jsonb_build_object('previous', v_item.assigned_to)
  );
end;
$$;

revoke all on function public.take_over_ticket(uuid) from public, anon;
grant execute on function public.take_over_ticket(uuid) to authenticated;
