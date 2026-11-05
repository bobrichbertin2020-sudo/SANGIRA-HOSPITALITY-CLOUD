-- Recipe-based stock consumption. When a kitchen/bar ticket moves from
-- pending to preparing, the recipe ingredients (per serving x quantity) are
-- deducted from the preparing department's stock location, first-expiry-first-out,
-- with a ledger entry per ingredient. Menu items without a recipe consume nothing.

alter type public.stock_movement_type add value if not exists 'consumption';

alter table public.order_items
  add column if not exists stock_consumed_at timestamptz;

create unique index if not exists stock_movements_order_item_consumption_once
  on public.stock_movements (reference_id, stock_item_id)
  where reference_type = 'order_item';

create or replace function public.consume_order_item_stock(
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
  v_location_id uuid;
  v_recipe record;
  v_needed numeric(14, 3);
  v_before numeric(14, 3);
  v_name text;
begin
  select * into v_item
    from public.order_items
    where id = p_item_id
    for update;

  if not found then
    raise exception 'Order item not found' using errcode = 'P0002';
  end if;

  if v_item.stock_consumed_at is not null then
    return;
  end if;

  select sl.id into v_location_id
    from public.stock_locations sl
    join public.departments d
      on d.id = sl.department_id and d.business_id = sl.business_id
    where sl.business_id = v_item.business_id
      and sl.is_active
      and d.department_key = v_item.department_key;

  for v_recipe in
    select r.stock_item_id, r.quantity
    from public.menu_recipes r
    where r.business_id = v_item.business_id
      and r.menu_item_id = v_item.menu_item_id
    order by r.stock_item_id
  loop
    if v_location_id is null then
      raise exception 'No stock location is configured for the % department',
        v_item.department_key using errcode = '23514';
    end if;

    v_needed := v_recipe.quantity * v_item.quantity;

    select b.quantity into v_before
      from public.stock_balances b
      where b.stock_location_id = v_location_id
        and b.stock_item_id = v_recipe.stock_item_id
        and b.business_id = v_item.business_id
      for update;

    if v_before is null or v_before < v_needed then
      select si.name into v_name
        from public.stock_items si
        where si.id = v_recipe.stock_item_id;
      raise exception 'Insufficient department stock of % to prepare %',
        coalesce(v_name, 'an ingredient'), v_item.item_name
        using errcode = '23514';
    end if;

    perform public.move_stock_batches(
      v_item.business_id, v_recipe.stock_item_id, v_location_id, v_needed
    );

    update public.stock_balances
      set quantity = quantity - v_needed, updated_at = now()
      where stock_location_id = v_location_id
        and stock_item_id = v_recipe.stock_item_id;

    insert into public.stock_movements (
      business_id, stock_item_id, stock_location_id, movement_type,
      quantity_delta, quantity_before, quantity_after,
      reference_type, reference_id, actor_user_id, reason
    ) values (
      v_item.business_id, v_recipe.stock_item_id, v_location_id, 'consumption',
      -v_needed, v_before, v_before - v_needed,
      'order_item', v_item.id, p_actor,
      'Order ' || v_item.order_code || ': ' || v_item.item_name
    );
  end loop;

  update public.order_items
    set stock_consumed_at = now()
    where id = v_item.id;
end;
$$;

revoke all on function public.consume_order_item_stock(uuid, uuid)
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
