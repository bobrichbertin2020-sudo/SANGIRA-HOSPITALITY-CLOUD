insert into public.permissions (permission_key, description) values
  ('orders.place', 'Place customer orders')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_key, permission_key) values
  ('business_owner', 'orders.place'),
  ('hotel_manager', 'orders.place'),
  ('kitchen_manager', 'orders.place'),
  ('bar_manager', 'orders.place'),
  ('cashier', 'orders.place'),
  ('server', 'orders.place')
on conflict (role_key, permission_key) do nothing;

alter table public.menu_items
  add column if not exists department_key text not null default 'kitchen';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.menu_items'::regclass
      and conname = 'menu_items_department_key_check'
  ) then
    alter table public.menu_items
      add constraint menu_items_department_key_check
      check (department_key in ('kitchen', 'bar'));
  end if;
end;
$$;

create type public.order_status as enum (
  'submitted', 'preparing', 'ready', 'served', 'cancelled'
);
create type public.order_item_status as enum (
  'pending', 'preparing', 'ready', 'delivered', 'cancelled'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  order_code text not null default (
    'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  table_label text not null check (char_length(btrim(table_label)) between 1 and 60),
  notes text check (notes is null or char_length(notes) <= 500),
  status public.order_status not null default 'submitted',
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, order_code)
);

create index orders_business_status_idx
  on public.orders (business_id, status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  order_code text not null,
  table_label text not null,
  menu_item_id uuid not null,
  item_name text not null,
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 50),
  department_key text not null check (department_key in ('kitchen', 'bar')),
  status public.order_item_status not null default 'pending',
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete restrict,
  foreign key (menu_item_id, business_id)
    references public.menu_items (id, business_id) on delete restrict
);

create index order_items_queue_idx
  on public.order_items (business_id, department_key, status, created_at);

create index order_items_order_idx on public.order_items (order_id);

create or replace function public.orders_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.orders_set_updated_at()
  from public, anon, authenticated;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.orders_set_updated_at();

drop trigger if exists order_items_set_updated_at on public.order_items;
create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function public.orders_set_updated_at();

create or replace function public.set_menu_item_department(
  p_business_id uuid,
  p_menu_item_id uuid,
  p_department_key text
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
  if not public.has_business_permission(p_business_id, 'menu.manage') then
    raise exception 'Menu management permission required' using errcode = '42501';
  end if;
  if p_department_key is null or p_department_key not in ('kitchen', 'bar') then
    raise exception 'Items route to the kitchen or bar' using errcode = '22023';
  end if;

  update public.menu_items
    set department_key = p_department_key
    where id = p_menu_item_id and business_id = p_business_id;

  if not found then
    raise exception 'Menu item not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'menu.item_routed', 'menu_item',
    p_menu_item_id::text, jsonb_build_object('department_key', p_department_key)
  );
end;
$$;

create or replace function public.place_order(
  p_business_id uuid,
  p_table_label text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_code text;
  v_table text := btrim(p_table_label);
  v_notes text := nullif(btrim(p_notes), '');
  v_count integer;
  v_total numeric(14, 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'orders.place') then
    raise exception 'Order placement permission required' using errcode = '42501';
  end if;
  if v_table is null or char_length(v_table) not between 1 and 60
    or char_length(coalesce(v_notes, '')) > 500
  then
    raise exception 'Enter a valid table or room label' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 40
  then
    raise exception 'An order needs between 1 and 40 items' using errcode = '22023';
  end if;

  create temporary table pg_temp.requested_order_items on commit drop as
  select r.menu_item_id, r.quantity
  from jsonb_to_recordset(p_items) as r(menu_item_id uuid, quantity integer);

  select count(*) into v_count from pg_temp.requested_order_items;

  if v_count <> jsonb_array_length(p_items)
    or exists (
      select 1 from pg_temp.requested_order_items r
      where r.menu_item_id is null or r.quantity is null
        or r.quantity not between 1 and 50
    )
    or (select count(distinct menu_item_id) from pg_temp.requested_order_items)
      <> v_count
    or exists (
      select 1
      from pg_temp.requested_order_items r
      left join public.menu_items mi
        on mi.id = r.menu_item_id
        and mi.business_id = p_business_id
        and mi.is_available
      left join public.departments d
        on d.business_id = p_business_id
        and d.department_key = mi.department_key
        and d.is_enabled
      where mi.id is null or d.id is null
    )
  then
    raise exception 'Choose unique available menu items with quantities from 1 to 50, routed to enabled departments'
      using errcode = '22023';
  end if;

  select coalesce(sum(mi.price * r.quantity), 0)
    into v_total
    from pg_temp.requested_order_items r
    join public.menu_items mi
      on mi.id = r.menu_item_id and mi.business_id = p_business_id;

  insert into public.orders (
    business_id, table_label, notes, total_amount, created_by
  ) values (
    p_business_id, v_table, v_notes, v_total, auth.uid()
  ) returning id, order_code into v_order_id, v_order_code;

  insert into public.order_items (
    business_id, order_id, order_code, table_label, menu_item_id,
    item_name, unit_price, quantity, department_key
  )
  select p_business_id, v_order_id, v_order_code, v_table, mi.id,
    mi.name, mi.price, r.quantity, mi.department_key
  from pg_temp.requested_order_items r
  join public.menu_items mi
    on mi.id = r.menu_item_id and mi.business_id = p_business_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'order.placed', 'order', v_order_id::text,
    jsonb_build_object('order_code', v_order_code, 'item_count', v_count,
      'total_amount', v_total)
  );

  drop table pg_temp.requested_order_items;
  return v_order_id;
end;
$$;

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

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Order staff read business orders" on public.orders;
create policy "Order staff read business orders"
  on public.orders for select to authenticated
  using ((select public.has_business_permission(business_id, 'orders.view')));

drop policy if exists "Order and department staff read order items" on public.order_items;
create policy "Order and department staff read order items"
  on public.order_items for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'orders.view'))
    or (
      department_key = 'kitchen'
      and (
        (select public.has_business_permission(business_id, 'kitchen.prepare'))
        or (select public.has_business_permission(business_id, 'kitchen.manage'))
      )
    )
    or (
      department_key = 'bar'
      and (
        (select public.has_business_permission(business_id, 'bar.prepare'))
        or (select public.has_business_permission(business_id, 'bar.manage'))
      )
    )
  );

revoke all on public.orders, public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;

revoke all on function public.set_menu_item_department(uuid, uuid, text)
  from public, anon;
revoke all on function public.place_order(uuid, text, text, jsonb)
  from public, anon;
revoke all on function public.update_order_item_status(uuid, public.order_item_status)
  from public, anon;
grant execute on function public.set_menu_item_department(uuid, uuid, text)
  to authenticated;
grant execute on function public.place_order(uuid, text, text, jsonb)
  to authenticated;
grant execute on function public.update_order_item_status(uuid, public.order_item_status)
  to authenticated;
