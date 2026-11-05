insert into public.permissions (permission_key, description) values
  ('menu.view', 'View business menu and recipes'),
  ('menu.manage', 'Manage menu categories, items, and recipes')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_key, permission_key) values
  ('business_owner', 'menu.view'),
  ('hotel_manager', 'menu.view'),
  ('kitchen_manager', 'menu.view'),
  ('kitchen_manager', 'menu.manage'),
  ('kitchen_staff', 'menu.view'),
  ('bar_manager', 'menu.view'),
  ('bar_manager', 'menu.manage'),
  ('bartender', 'menu.view'),
  ('cashier', 'menu.view'),
  ('server', 'menu.view')
on conflict (role_key, permission_key) do nothing;

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create unique index menu_categories_business_name_idx
  on public.menu_categories (business_id, lower(name));

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  category_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text check (description is null or char_length(description) <= 1000),
  price numeric(14, 2) not null check (price >= 0),
  is_available boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (category_id, business_id)
    references public.menu_categories (id, business_id) on delete restrict
);

create unique index menu_items_business_name_idx
  on public.menu_items (business_id, lower(name));

create index menu_items_business_category_idx
  on public.menu_items (business_id, category_id, lower(name));

create table public.menu_recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  menu_item_id uuid not null,
  stock_item_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_item_id, stock_item_id),
  foreign key (menu_item_id, business_id)
    references public.menu_items (id, business_id) on delete cascade,
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict
);

create index menu_recipes_business_item_idx
  on public.menu_recipes (business_id, menu_item_id);

create or replace function public.create_menu_category(
  p_business_id uuid,
  p_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'menu.manage') then
    raise exception 'Menu management permission required' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 100
    or char_length(coalesce(v_description, '')) > 500
  then
    raise exception 'Enter a valid category name and description'
      using errcode = '22023';
  end if;

  insert into public.menu_categories (
    business_id, name, description, created_by
  ) values (
    p_business_id, v_name, v_description, auth.uid()
  ) returning id into v_category_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'menu.category_created', 'menu_category',
    v_category_id::text, jsonb_build_object('name', v_name)
  );
  return v_category_id;
end;
$$;

create or replace function public.create_menu_item(
  p_business_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'menu.manage') then
    raise exception 'Menu management permission required' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 160
    or char_length(coalesce(v_description, '')) > 1000
    or p_price is null or p_price < 0
  then
    raise exception 'Enter a valid item name, description, and price'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.menu_categories c
    where c.id = p_category_id
      and c.business_id = p_business_id
      and c.is_active
  ) then
    raise exception 'Choose an active category belonging to this business'
      using errcode = '22023';
  end if;

  insert into public.menu_items (
    business_id, category_id, name, description, price, created_by
  ) values (
    p_business_id, p_category_id, v_name, v_description, p_price, auth.uid()
  ) returning id into v_item_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'menu.item_created', 'menu_item',
    v_item_id::text, jsonb_build_object('name', v_name, 'price', p_price)
  );
  return v_item_id;
end;
$$;

create or replace function public.save_menu_recipe(
  p_business_id uuid,
  p_menu_item_id uuid,
  p_ingredients jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ingredient_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'menu.manage') then
    raise exception 'Menu management permission required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.menu_items mi
    where mi.id = p_menu_item_id
      and mi.business_id = p_business_id
  ) then
    raise exception 'Menu item not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_ingredients) is distinct from 'array' then
    raise exception 'Recipe ingredients must be provided as an array'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_ingredients) > 50 then
    raise exception 'Provide at most 50 recipe ingredients'
      using errcode = '22023';
  end if;

  select count(*) into v_ingredient_count
  from jsonb_to_recordset(p_ingredients)
    as requested(stock_item_id uuid, quantity numeric);

  if exists (
    select 1
    from jsonb_to_recordset(p_ingredients)
      as requested(stock_item_id uuid, quantity numeric)
    left join public.stock_items si
      on si.id = requested.stock_item_id
      and si.business_id = p_business_id
      and si.is_active
    where requested.stock_item_id is null
      or requested.quantity is null
      or requested.quantity <= 0
      or requested.quantity::text in ('NaN', 'Infinity', '-Infinity')
      or requested.quantity <> round(requested.quantity, 3)
      or si.id is null
  ) or (
    select count(distinct requested.stock_item_id)
    from jsonb_to_recordset(p_ingredients)
      as requested(stock_item_id uuid, quantity numeric)
  ) <> v_ingredient_count then
    raise exception 'Recipe ingredients must be unique active stock items with positive quantities'
      using errcode = '22023';
  end if;

  delete from public.menu_recipes
  where menu_item_id = p_menu_item_id
    and business_id = p_business_id;

  insert into public.menu_recipes (
    business_id, menu_item_id, stock_item_id, quantity
  )
  select p_business_id, p_menu_item_id,
    requested.stock_item_id, requested.quantity
  from jsonb_to_recordset(p_ingredients)
    as requested(stock_item_id uuid, quantity numeric);

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'menu.recipe_saved', 'menu_item',
    p_menu_item_id::text,
    jsonb_build_object('ingredient_count', v_ingredient_count)
  );
end;
$$;

create or replace function public.menu_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger menu_categories_set_updated_at
  before update on public.menu_categories
  for each row execute function public.menu_set_updated_at();

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.menu_set_updated_at();

create trigger menu_recipes_set_updated_at
  before update on public.menu_recipes
  for each row execute function public.menu_set_updated_at();

alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_recipes enable row level security;

create policy "Members read authorized menu categories"
  on public.menu_categories for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'menu.view'))
    or (select public.has_business_permission(business_id, 'menu.manage'))
  );

create policy "Members read authorized menu items"
  on public.menu_items for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'menu.view'))
    or (select public.has_business_permission(business_id, 'menu.manage'))
  );

create policy "Members read authorized menu recipes"
  on public.menu_recipes for select to authenticated
  using ((select public.has_business_permission(business_id, 'menu.manage')));

revoke all on public.menu_categories, public.menu_items, public.menu_recipes
  from anon, authenticated;
grant select on public.menu_categories, public.menu_items, public.menu_recipes
  to authenticated;

revoke all on function public.create_menu_category(uuid, text, text)
  from public, anon;
revoke all on function public.create_menu_item(uuid, uuid, text, text, numeric)
  from public, anon;
revoke all on function public.save_menu_recipe(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.create_menu_category(uuid, text, text)
  to authenticated;
grant execute on function public.create_menu_item(uuid, uuid, text, text, numeric)
  to authenticated;
grant execute on function public.save_menu_recipe(uuid, uuid, jsonb)
  to authenticated;
revoke all on function public.menu_set_updated_at() from public, anon, authenticated;
