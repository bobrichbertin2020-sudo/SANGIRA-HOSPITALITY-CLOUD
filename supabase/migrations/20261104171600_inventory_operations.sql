do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.departments'::regclass
      and conname = 'departments_id_business_key'
  ) then
    alter table public.departments
      add constraint departments_id_business_key unique (id, business_id);
  end if;
end;
$$;

insert into public.permissions (permission_key, description) values
  ('inventory.request', 'Request stock for assigned departments'),
  ('inventory.requests.review', 'Review and issue business stock requests')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_key, permission_key) values
  ('business_owner', 'inventory.request'),
  ('business_owner', 'inventory.requests.review'),
  ('hotel_manager', 'inventory.request'),
  ('hotel_manager', 'inventory.requests.review'),
  ('kitchen_manager', 'inventory.request'),
  ('bar_manager', 'inventory.request'),
  ('bartender', 'inventory.request'),
  ('stock_manager', 'inventory.request'),
  ('stock_manager', 'inventory.requests.review')
on conflict (role_key, permission_key) do nothing;

create or replace function public.has_business_permission(
  p_business_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_memberships bm
    join public.businesses b on b.id = bm.business_id
    join public.membership_roles mr on mr.membership_id = bm.id
    join public.role_permissions rp on rp.role_key = mr.role_key
    where bm.business_id = p_business_id
      and bm.user_id = (select auth.uid())
      and bm.status = 'active'
      and b.status = 'active'
      and rp.permission_key = p_permission_key
  );
$$;

create or replace function public.has_department_permission(
  p_business_id uuid,
  p_department_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_memberships bm
    join public.businesses b on b.id = bm.business_id
    join public.membership_roles mr on mr.membership_id = bm.id
    join public.role_permissions rp on rp.role_key = mr.role_key
    join public.membership_departments md on md.membership_id = bm.id
    join public.departments d on d.id = md.department_id
    where bm.business_id = p_business_id
      and bm.user_id = (select auth.uid())
      and bm.status = 'active'
      and b.status = 'active'
      and d.id = p_department_id
      and d.business_id = p_business_id
      and d.is_enabled
      and (
        p_permission_key <> 'inventory.request'
        or (
          (d.department_key = 'kitchen' and mr.role_key = 'kitchen_manager')
          or (
            d.department_key = 'bar'
            and mr.role_key in ('bar_manager', 'bartender')
          )
          or (d.department_key = 'stock' and mr.role_key = 'stock_manager')
        )
      )
      and rp.permission_key = p_permission_key
  );
$$;

create type public.stock_location_type as enum ('central', 'department');
create type public.stock_request_status as enum (
  'submitted',
  'approved',
  'partially_approved',
  'rejected',
  'issued',
  'partially_issued',
  'cancelled'
);
create type public.stock_movement_type as enum (
  'receipt',
  'department_issue',
  'department_receipt',
  'adjustment_in',
  'adjustment_out',
  'wastage'
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  address text check (address is null or char_length(address) <= 500),
  is_active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create unique index suppliers_business_name_idx
  on public.suppliers (business_id, lower(name));

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  sku text not null check (char_length(btrim(sku)) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  unit text not null check (char_length(btrim(unit)) between 1 and 32),
  minimum_quantity numeric(14, 3) not null default 0
    check (minimum_quantity >= 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create unique index stock_items_business_sku_idx
  on public.stock_items (business_id, lower(sku));

create index stock_items_business_name_idx
  on public.stock_items (business_id, lower(name));

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  department_id uuid,
  location_type public.stock_location_type not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (department_id, business_id)
    references public.departments (id, business_id) on delete restrict,
  constraint stock_location_department_type check (
    (location_type = 'central' and department_id is null)
    or (location_type = 'department' and department_id is not null)
  )
);

create unique index stock_locations_one_central_per_business
  on public.stock_locations (business_id)
  where location_type = 'central';

create unique index stock_locations_one_per_department
  on public.stock_locations (department_id)
  where department_id is not null;

create table public.stock_balances (
  business_id uuid not null references public.businesses (id) on delete restrict,
  stock_location_id uuid not null,
  stock_item_id uuid not null,
  quantity numeric(14, 3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (stock_location_id, stock_item_id),
  foreign key (stock_location_id, business_id)
    references public.stock_locations (id, business_id) on delete restrict,
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict
);

create index stock_balances_item_business_idx
  on public.stock_balances (business_id, stock_item_id);

create table public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  department_id uuid not null,
  requested_by uuid not null references auth.users (id) on delete restrict,
  status public.stock_request_status not null default 'submitted',
  request_notes text check (request_notes is null or char_length(request_notes) <= 1000),
  review_notes text check (review_notes is null or char_length(review_notes) <= 1000),
  reviewed_by uuid references auth.users (id) on delete restrict,
  reviewed_at timestamptz,
  issued_by uuid references auth.users (id) on delete restrict,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (department_id, business_id)
    references public.departments (id, business_id) on delete restrict,
  constraint stock_request_review_state check (
    (status in ('submitted', 'cancelled') and reviewed_by is null and reviewed_at is null)
    or (
      status in (
        'approved',
        'partially_approved',
        'rejected',
        'issued',
        'partially_issued'
      )
      and reviewed_by is not null
      and reviewed_at is not null
    )
  ),
  constraint stock_request_issue_state check (
    (status in ('issued', 'partially_issued') and issued_by is not null and issued_at is not null)
    or (status not in ('issued', 'partially_issued') and issued_by is null and issued_at is null)
  )
);

create index stock_requests_queue_idx
  on public.stock_requests (business_id, status, created_at);

create index stock_requests_department_idx
  on public.stock_requests (business_id, department_id, created_at desc);

create table public.stock_request_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  request_id uuid not null,
  stock_item_id uuid not null,
  requested_quantity numeric(14, 3) not null check (requested_quantity > 0),
  approved_quantity numeric(14, 3) not null default 0
    check (approved_quantity >= 0 and approved_quantity <= requested_quantity),
  issued_quantity numeric(14, 3) not null default 0
    check (issued_quantity >= 0 and issued_quantity <= approved_quantity),
  created_at timestamptz not null default now(),
  unique (request_id, stock_item_id),
  foreign key (request_id, business_id)
    references public.stock_requests (id, business_id) on delete restrict,
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict,
  unique (id, business_id)
);

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  idempotency_key uuid not null,
  stock_item_id uuid not null,
  stock_location_id uuid not null,
  supplier_id uuid,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  batch_number text check (batch_number is null or char_length(batch_number) <= 100),
  expires_at date,
  reference_number text check (reference_number is null or char_length(reference_number) <= 100),
  received_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  unique (id, business_id),
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict,
  foreign key (stock_location_id, business_id)
    references public.stock_locations (id, business_id) on delete restrict,
  foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id) on delete restrict
);

create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  receipt_id uuid,
  stock_item_id uuid not null,
  stock_location_id uuid not null,
  batch_number text,
  expires_at date,
  initial_quantity numeric(14, 3) not null check (initial_quantity > 0),
  remaining_quantity numeric(14, 3) not null check (
    remaining_quantity >= 0 and remaining_quantity <= initial_quantity
  ),
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (receipt_id, business_id)
    references public.stock_receipts (id, business_id) on delete restrict,
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict,
  foreign key (stock_location_id, business_id)
    references public.stock_locations (id, business_id) on delete restrict
);

create index stock_batches_expiry_idx
  on public.stock_batches (business_id, expires_at)
  where remaining_quantity > 0;

create or replace function public.move_stock_batches(
  p_business_id uuid,
  p_stock_item_id uuid,
  p_source_location_id uuid,
  p_quantity numeric,
  p_destination_location_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch record;
  v_remaining numeric(14, 3) := p_quantity;
  v_taken numeric(14, 3);
begin
  for v_batch in
    select id, receipt_id, batch_number, expires_at, remaining_quantity
    from public.stock_batches
    where business_id = p_business_id
      and stock_item_id = p_stock_item_id
      and stock_location_id = p_source_location_id
      and remaining_quantity > 0
      and (
        p_destination_location_id is null
        or expires_at is null
        or expires_at >= current_date
      )
    order by expires_at asc nulls last, created_at asc, id asc
    for update
  loop
    exit when v_remaining = 0;
    v_taken := least(v_batch.remaining_quantity, v_remaining);

    update public.stock_batches
      set remaining_quantity = remaining_quantity - v_taken
      where id = v_batch.id;

    if p_destination_location_id is not null then
      insert into public.stock_batches (
        business_id, receipt_id, stock_item_id, stock_location_id,
        batch_number, expires_at, initial_quantity, remaining_quantity
      )
      values (
        p_business_id, v_batch.receipt_id, p_stock_item_id,
        p_destination_location_id, v_batch.batch_number, v_batch.expires_at,
        v_taken, v_taken
      );
    end if;

    v_remaining := v_remaining - v_taken;
  end loop;

  if v_remaining > 0 then
    raise exception 'Insufficient unexpired batch stock for item %', p_stock_item_id
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.move_stock_batches(uuid, uuid, uuid, numeric, uuid)
  from public, anon, authenticated;

create table public.stock_movements (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  stock_item_id uuid not null,
  stock_location_id uuid not null,
  movement_type public.stock_movement_type not null,
  quantity_delta numeric(14, 3) not null check (quantity_delta <> 0),
  quantity_before numeric(14, 3) not null check (quantity_before >= 0),
  quantity_after numeric(14, 3) not null check (quantity_after >= 0),
  reference_type text not null,
  reference_id uuid not null,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  constraint stock_movement_delta_matches_balance check (
    quantity_after - quantity_before = quantity_delta
  ),
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict,
  foreign key (stock_location_id, business_id)
    references public.stock_locations (id, business_id) on delete restrict
);

create index stock_movements_business_item_date_idx
  on public.stock_movements (business_id, stock_item_id, created_at desc);

create index stock_movements_reference_idx
  on public.stock_movements (reference_type, reference_id);

create unique index stock_movements_request_issue_once
  on public.stock_movements (reference_id, movement_type)
  where reference_type = 'stock_request_item';

create or replace function public.create_stock_locations_for_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_locations (business_id, location_type, name)
  values (new.id, 'central', 'Central stock')
  on conflict (business_id) where location_type = 'central' do nothing;
  return new;
end;
$$;

drop trigger if exists create_business_central_stock_location on public.businesses;
create trigger create_business_central_stock_location
  after insert on public.businesses
  for each row execute function public.create_stock_locations_for_business();

create or replace function public.create_stock_location_for_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_locations (business_id, department_id, location_type, name)
  values (new.business_id, new.id, 'department', new.name || ' stock')
  on conflict (department_id) where department_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists create_department_stock_location on public.departments;
create trigger create_department_stock_location
  after insert on public.departments
  for each row execute function public.create_stock_location_for_department();

revoke all on function public.create_stock_locations_for_business()
  from public, anon, authenticated;
revoke all on function public.create_stock_location_for_department()
  from public, anon, authenticated;

insert into public.stock_locations (business_id, location_type, name)
select b.id, 'central', 'Central stock'
from public.businesses b
on conflict (business_id) where location_type = 'central' do nothing;

insert into public.stock_locations (business_id, department_id, location_type, name)
select d.business_id, d.id, 'department', d.name || ' stock'
from public.departments d
on conflict (department_id) where department_id is not null do nothing;

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists stock_items_set_updated_at on public.stock_items;
create trigger stock_items_set_updated_at
  before update on public.stock_items
  for each row execute function public.set_updated_at();

drop trigger if exists stock_requests_set_updated_at on public.stock_requests;
create trigger stock_requests_set_updated_at
  before update on public.stock_requests
  for each row execute function public.set_updated_at();

create or replace function public.create_supplier(
  p_business_id uuid,
  p_name text,
  p_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_business_permission(p_business_id, 'inventory.manage') then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;

  if p_name is null or char_length(btrim(p_name)) not between 2 and 160
    or (p_contact_name is not null and char_length(p_contact_name) > 120)
    or (p_email is not null and char_length(p_email) > 254)
    or (
      nullif(btrim(p_email), '') is not null
      and lower(btrim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
    or (p_phone is not null and char_length(p_phone) > 40)
    or (p_address is not null and char_length(p_address) > 500)
  then
    raise exception 'Invalid supplier details' using errcode = '22023';
  end if;

  insert into public.suppliers (
    business_id, name, contact_name, email, phone, address, created_by
  )
  values (
    p_business_id,
    btrim(p_name),
    nullif(btrim(p_contact_name), ''),
    nullif(lower(btrim(p_email)), ''),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_address), ''),
    auth.uid()
  )
  returning id into v_supplier_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id
  )
  values (
    p_business_id, auth.uid(), 'supplier.created', 'supplier', v_supplier_id::text
  );

  return v_supplier_id;
end;
$$;

create or replace function public.create_stock_item(
  p_business_id uuid,
  p_sku text,
  p_name text,
  p_unit text,
  p_minimum_quantity numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock_item_id uuid;
  v_location record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_business_permission(p_business_id, 'inventory.manage') then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;

  if p_sku is null or char_length(btrim(p_sku)) not between 1 and 64
    or p_name is null or char_length(btrim(p_name)) not between 2 and 160
    or p_unit is null or char_length(btrim(p_unit)) not between 1 and 32
    or p_minimum_quantity is null or p_minimum_quantity < 0
    or p_minimum_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_minimum_quantity <> round(p_minimum_quantity, 3)
  then
    raise exception 'Invalid stock item details' using errcode = '22023';
  end if;

  insert into public.stock_items (
    business_id, sku, name, unit, minimum_quantity, created_by
  )
  values (
    p_business_id,
    btrim(p_sku),
    btrim(p_name),
    btrim(p_unit),
    p_minimum_quantity,
    auth.uid()
  )
  returning id into v_stock_item_id;

  for v_location in
    select id
    from public.stock_locations
    where business_id = p_business_id and is_active
  loop
    insert into public.stock_balances (
      business_id, stock_location_id, stock_item_id, quantity
    )
    values (p_business_id, v_location.id, v_stock_item_id, 0);
  end loop;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id,
    details
  )
  values (
    p_business_id,
    auth.uid(),
    'stock_item.created',
    'stock_item',
    v_stock_item_id::text,
    jsonb_build_object('sku', btrim(p_sku), 'name', btrim(p_name))
  );

  return v_stock_item_id;
end;
$$;

create or replace function public.receive_stock(
  p_business_id uuid,
  p_idempotency_key uuid,
  p_stock_item_id uuid,
  p_stock_location_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_supplier_id uuid default null,
  p_batch_number text default null,
  p_expires_at date default null,
  p_reference_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt_id uuid;
  v_existing public.stock_receipts%rowtype;
  v_before numeric(14, 3);
  v_after numeric(14, 3);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_business_permission(p_business_id, 'inventory.manage') then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;

  if p_idempotency_key is null
    or p_quantity is null or p_quantity <= 0
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity <> round(p_quantity, 3)
    or p_unit_cost is null or p_unit_cost < 0
    or p_unit_cost::text in ('NaN', 'Infinity', '-Infinity')
    or p_unit_cost <> round(p_unit_cost, 2)
    or (p_batch_number is not null and char_length(p_batch_number) > 100)
    or (p_reference_number is not null and char_length(p_reference_number) > 100)
    or (p_expires_at is not null and p_expires_at < current_date)
  then
    raise exception 'Invalid stock receipt details' using errcode = '22023';
  end if;

  select *
    into v_existing
    from public.stock_receipts
    where business_id = p_business_id
      and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.stock_item_id <> p_stock_item_id
      or v_existing.stock_location_id <> p_stock_location_id
      or v_existing.quantity <> p_quantity
      or v_existing.unit_cost <> p_unit_cost
      or v_existing.supplier_id is distinct from p_supplier_id
      or v_existing.batch_number is distinct from nullif(btrim(p_batch_number), '')
      or v_existing.expires_at is distinct from p_expires_at
      or v_existing.reference_number is distinct from nullif(btrim(p_reference_number), '')
    then
      raise exception 'Idempotency key was already used for a different receipt'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if not exists (
    select 1
    from public.stock_locations l
    where l.id = p_stock_location_id
      and l.business_id = p_business_id
      and l.location_type = 'central'
      and l.is_active
  ) then
    raise exception 'Stock must be received into this business central location'
      using errcode = '22023';
  end if;

  insert into public.stock_receipts (
    business_id, idempotency_key, stock_item_id, stock_location_id,
    supplier_id, quantity, unit_cost, batch_number, expires_at,
    reference_number, received_by
  )
  values (
    p_business_id, p_idempotency_key, p_stock_item_id, p_stock_location_id,
    p_supplier_id, p_quantity, p_unit_cost, nullif(btrim(p_batch_number), ''),
    p_expires_at, nullif(btrim(p_reference_number), ''), auth.uid()
  )
  returning id into v_receipt_id;

  insert into public.stock_balances (
    business_id, stock_location_id, stock_item_id, quantity
  )
  values (p_business_id, p_stock_location_id, p_stock_item_id, 0)
  on conflict (stock_location_id, stock_item_id) do nothing;

  select quantity
    into v_before
    from public.stock_balances
    where stock_location_id = p_stock_location_id
      and stock_item_id = p_stock_item_id
    for update;

  v_after := v_before + p_quantity;

  update public.stock_balances
    set quantity = v_after, updated_at = now()
    where stock_location_id = p_stock_location_id
      and stock_item_id = p_stock_item_id;

  insert into public.stock_batches (
    business_id, receipt_id, stock_item_id, stock_location_id,
    batch_number, expires_at, initial_quantity, remaining_quantity
  )
  values (
    p_business_id, v_receipt_id, p_stock_item_id, p_stock_location_id,
    nullif(btrim(p_batch_number), ''), p_expires_at, p_quantity, p_quantity
  );

  insert into public.stock_movements (
    business_id, stock_item_id, stock_location_id, movement_type,
    quantity_delta, quantity_before, quantity_after, reference_type,
    reference_id, actor_user_id
  )
  values (
    p_business_id, p_stock_item_id, p_stock_location_id, 'receipt',
    p_quantity, v_before, v_after, 'stock_receipt', v_receipt_id, auth.uid()
  );

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  )
  values (
    p_business_id, auth.uid(), 'stock.received', 'stock_receipt',
    v_receipt_id::text,
    jsonb_build_object(
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity,
      'unit_cost', p_unit_cost,
      'supplier_id', p_supplier_id
    )
  );

  return v_receipt_id;
end;
$$;

create or replace function public.request_stock(
  p_business_id uuid,
  p_department_id uuid,
  p_items jsonb,
  p_request_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_count integer := 0;
  v_distinct_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_department_permission(
    p_business_id, p_department_id, 'inventory.request'
  ) then
    raise exception 'You cannot request stock for this department'
      using errcode = '42501';
  end if;

  if p_request_notes is not null and char_length(p_request_notes) > 1000 then
    raise exception 'Request notes are too long' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Request items must be provided as a list'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'A request must contain between 1 and 50 stock items'
      using errcode = '22023';
  end if;

  select count(distinct value ->> 'stock_item_id')
    into v_distinct_count
    from jsonb_array_elements(p_items);

  if v_distinct_count <> jsonb_array_length(p_items) then
    raise exception 'Each stock item may only appear once per request'
      using errcode = '22023';
  end if;

  insert into public.stock_requests (
    business_id, department_id, requested_by, request_notes
  )
  values (
    p_business_id, p_department_id, auth.uid(), nullif(btrim(p_request_notes), '')
  )
  returning id into v_request_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := (v_item ->> 'stock_item_id')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid stock item or quantity in request'
        using errcode = '22023';
    end;

    if v_item_id is null or v_quantity is null or v_quantity <= 0
      or v_quantity::text in ('NaN', 'Infinity', '-Infinity')
      or v_quantity <> round(v_quantity, 3)
      or not exists (
        select 1 from public.stock_items i
        where i.id = v_item_id and i.business_id = p_business_id and i.is_active
      )
    then
      raise exception 'Every request item must be active and have a positive quantity'
        using errcode = '22023';
    end if;

    insert into public.stock_request_items (
      business_id, request_id, stock_item_id, requested_quantity
    )
    values (p_business_id, v_request_id, v_item_id, v_quantity);

    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  )
  values (
    p_business_id,
    auth.uid(),
    'stock_request.created',
    'stock_request',
    v_request_id::text,
    jsonb_build_object('department_id', p_department_id, 'item_count', v_count)
  );

  return v_request_id;
end;
$$;

create or replace function public.review_stock_request(
  p_request_id uuid,
  p_approved_items jsonb,
  p_reject boolean default false,
  p_review_notes text default null
)
returns public.stock_request_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.stock_requests%rowtype;
  v_item public.stock_request_items%rowtype;
  v_approved numeric;
  v_approved_count integer := 0;
  v_full_count integer := 0;
  v_item_count integer;
  v_new_status public.stock_request_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select *
    into v_request
    from public.stock_requests
    where id = p_request_id
    for update;

  if not found then
    raise exception 'Stock request not found' using errcode = 'P0002';
  end if;

  if not public.has_business_permission(
    v_request.business_id, 'inventory.requests.review'
  ) then
    raise exception 'Stock request review permission required'
      using errcode = '42501';
  end if;

  if v_request.requested_by = auth.uid() then
    raise exception 'You cannot review your own stock request'
      using errcode = '42501';
  end if;

  if v_request.status <> 'submitted' then
    raise exception 'Only submitted requests can be reviewed'
      using errcode = '22023';
  end if;

  if p_review_notes is not null and char_length(p_review_notes) > 1000 then
    raise exception 'Review notes are too long' using errcode = '22023';
  end if;

  select count(*) into v_item_count
    from public.stock_request_items
    where request_id = p_request_id;

  if p_reject then
    update public.stock_request_items
      set approved_quantity = 0
      where request_id = p_request_id;
    v_new_status := 'rejected';
  else
    if p_approved_items is null or jsonb_typeof(p_approved_items) <> 'array' then
      raise exception 'Review quantities must be provided as a list'
        using errcode = '22023';
    end if;

    if jsonb_array_length(p_approved_items) <> v_item_count then
      raise exception 'Review must include an approved quantity for every request item'
        using errcode = '22023';
    end if;

    select count(distinct value ->> 'item_id')
      into v_approved_count
      from jsonb_array_elements(p_approved_items);

    if v_approved_count <> v_item_count then
      raise exception 'Review must include each request item exactly once'
        using errcode = '22023';
    end if;

    v_approved_count := 0;

    for v_item in
      select *
      from public.stock_request_items
      where request_id = p_request_id
      order by stock_item_id
      for update
    loop
      begin
        select (entry ->> 'approved_quantity')::numeric
          into v_approved
          from jsonb_array_elements(p_approved_items) entry
          where entry ->> 'item_id' = v_item.id::text;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Invalid approved quantity' using errcode = '22023';
      end;

      if v_approved is null or v_approved < 0
        or v_approved > v_item.requested_quantity
        or v_approved::text in ('NaN', 'Infinity', '-Infinity')
        or v_approved <> round(v_approved, 3)
      then
        raise exception 'Approved quantities must be between zero and requested quantities'
          using errcode = '22023';
      end if;

      update public.stock_request_items
        set approved_quantity = v_approved
        where id = v_item.id;

      if v_approved > 0 then
        v_approved_count := v_approved_count + 1;
      end if;
      if v_approved = v_item.requested_quantity then
        v_full_count := v_full_count + 1;
      end if;
    end loop;

    if v_approved_count = 0 then
      raise exception 'Approve at least one item or reject the request'
        using errcode = '22023';
    elsif v_full_count = v_item_count then
      v_new_status := 'approved';
    else
      v_new_status := 'partially_approved';
    end if;
  end if;

  update public.stock_requests
    set status = v_new_status,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_notes = nullif(btrim(p_review_notes), '')
    where id = p_request_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  )
  values (
    v_request.business_id,
    auth.uid(),
    'stock_request.' || v_new_status::text,
    'stock_request',
    p_request_id::text,
    jsonb_build_object('review_notes', nullif(btrim(p_review_notes), ''))
  );

  return v_new_status;
end;
$$;

create or replace function public.issue_stock_request(
  p_request_id uuid,
  p_issued_items jsonb
)
returns public.stock_request_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.stock_requests%rowtype;
  v_item public.stock_request_items%rowtype;
  v_quantity numeric;
  v_central_id uuid;
  v_department_id uuid;
  v_before numeric(14, 3);
  v_after numeric(14, 3);
  v_central_before numeric(14, 3);
  v_central_after numeric(14, 3);
  v_item_count integer;
  v_issued_count integer := 0;
  v_full_count integer := 0;
  v_new_status public.stock_request_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select *
    into v_request
    from public.stock_requests
    where id = p_request_id
    for update;

  if not found then
    raise exception 'Stock request not found' using errcode = 'P0002';
  end if;

  if not public.has_business_permission(
    v_request.business_id, 'inventory.requests.review'
  ) then
    raise exception 'Stock request issuance permission required'
      using errcode = '42501';
  end if;

  if v_request.status not in ('approved', 'partially_approved') then
    raise exception 'Only approved requests can be issued'
      using errcode = '22023';
  end if;

  if v_request.requested_by = auth.uid() or v_request.reviewed_by = auth.uid() then
    raise exception 'The requester or reviewer cannot issue this request'
      using errcode = '42501';
  end if;

  select count(*) into v_item_count
    from public.stock_request_items
    where request_id = p_request_id;

  if p_issued_items is null or jsonb_typeof(p_issued_items) <> 'array' then
    raise exception 'Issued quantities must be provided as a list'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_issued_items) <> v_item_count then
    raise exception 'Issuance must include an issued quantity for every request item'
      using errcode = '22023';
  end if;

  select count(distinct value ->> 'item_id')
    into v_issued_count
    from jsonb_array_elements(p_issued_items);

  if v_issued_count <> v_item_count then
    raise exception 'Issuance must include each request item exactly once'
      using errcode = '22023';
  end if;

  v_issued_count := 0;

  select l.id
    into v_central_id
    from public.stock_locations l
    where l.business_id = v_request.business_id
      and l.location_type = 'central'
      and l.is_active;

  select l.id
    into v_department_id
    from public.stock_locations l
    where l.business_id = v_request.business_id
      and l.department_id = v_request.department_id
      and l.location_type = 'department'
      and l.is_active;

  if v_central_id is null or v_department_id is null then
    raise exception 'Stock locations are not configured for this request'
      using errcode = 'P0002';
  end if;

  for v_item in
    select *
    from public.stock_request_items
    where request_id = p_request_id
    order by stock_item_id
    for update
  loop
    begin
      select (entry ->> 'issued_quantity')::numeric
        into v_quantity
        from jsonb_array_elements(p_issued_items) entry
        where entry ->> 'item_id' = v_item.id::text;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid issued quantity' using errcode = '22023';
    end;

    if v_quantity is null or v_quantity < 0
      or v_quantity > v_item.approved_quantity
      or v_quantity::text in ('NaN', 'Infinity', '-Infinity')
      or v_quantity <> round(v_quantity, 3)
    then
      raise exception 'Issued quantities must be between zero and approved quantities'
        using errcode = '22023';
    end if;

    if v_quantity > 0 then
      insert into public.stock_balances (
        business_id, stock_location_id, stock_item_id, quantity
      )
      values (v_request.business_id, v_central_id, v_item.stock_item_id, 0)
      on conflict (stock_location_id, stock_item_id) do nothing;

      select quantity
        into v_central_before
        from public.stock_balances
        where stock_location_id = v_central_id
          and stock_item_id = v_item.stock_item_id
        for update;

      if v_central_before < v_quantity then
        raise exception 'Insufficient central stock for item %', v_item.stock_item_id
          using errcode = '23514';
      end if;

      perform public.move_stock_batches(
        v_request.business_id,
        v_item.stock_item_id,
        v_central_id,
        v_quantity,
        v_department_id
      );

      v_central_after := v_central_before - v_quantity;

      update public.stock_balances
        set quantity = v_central_after, updated_at = now()
        where stock_location_id = v_central_id
          and stock_item_id = v_item.stock_item_id;

      insert into public.stock_balances (
        business_id, stock_location_id, stock_item_id, quantity
      )
      values (v_request.business_id, v_department_id, v_item.stock_item_id, 0)
      on conflict (stock_location_id, stock_item_id) do nothing;

      select quantity
        into v_before
        from public.stock_balances
        where stock_location_id = v_department_id
          and stock_item_id = v_item.stock_item_id
        for update;

      v_after := v_before + v_quantity;

      update public.stock_balances
        set quantity = v_after, updated_at = now()
        where stock_location_id = v_department_id
          and stock_item_id = v_item.stock_item_id;

      update public.stock_request_items
        set issued_quantity = v_quantity
        where id = v_item.id;

      insert into public.stock_movements (
        business_id, stock_item_id, stock_location_id, movement_type,
        quantity_delta, quantity_before, quantity_after, reference_type,
        reference_id, actor_user_id
      )
      values
        (
          v_request.business_id, v_item.stock_item_id, v_central_id,
          'department_issue', -v_quantity, v_central_before, v_central_after,
          'stock_request_item', v_item.id, auth.uid()
        ),
        (
          v_request.business_id, v_item.stock_item_id, v_department_id,
          'department_receipt', v_quantity, v_before, v_after,
          'stock_request_item', v_item.id, auth.uid()
        );

      v_issued_count := v_issued_count + 1;
    else
      update public.stock_request_items
        set issued_quantity = 0
        where id = v_item.id;
    end if;

    if v_quantity = v_item.approved_quantity then
      v_full_count := v_full_count + 1;
    end if;
  end loop;

  if v_issued_count = 0 then
    raise exception 'Issue at least one approved item' using errcode = '22023';
  end if;

  if v_full_count = v_item_count then
    v_new_status := 'issued';
  else
    v_new_status := 'partially_issued';
  end if;

  update public.stock_requests
    set status = v_new_status,
        issued_by = auth.uid(),
        issued_at = now()
    where id = p_request_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  )
  values (
    v_request.business_id,
    auth.uid(),
    'stock_request.' || v_new_status::text,
    'stock_request',
    p_request_id::text,
    jsonb_build_object('department_id', v_request.department_id)
  );

  return v_new_status;
end;
$$;

create or replace function public.adjust_stock(
  p_business_id uuid,
  p_stock_item_id uuid,
  p_stock_location_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_is_wastage boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before numeric(14, 3);
  v_after numeric(14, 3);
  v_movement_id bigint;
  v_movement_type public.stock_movement_type;
  v_reference_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_business_permission(p_business_id, 'inventory.manage') then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0
    or p_quantity_delta::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity_delta <> round(p_quantity_delta, 3)
    or p_reason is null or char_length(btrim(p_reason)) < 3
    or char_length(p_reason) > 500
  then
    raise exception 'A non-zero adjustment and reason are required'
      using errcode = '22023';
  end if;

  if p_is_wastage and p_quantity_delta > 0 then
    raise exception 'Wastage must decrease stock' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.stock_locations l
    where l.id = p_stock_location_id
      and l.business_id = p_business_id
      and l.is_active
  ) or not exists (
    select 1 from public.stock_items i
    where i.id = p_stock_item_id
      and i.business_id = p_business_id
      and i.is_active
  ) then
    raise exception 'Stock item or location does not belong to this business'
      using errcode = '22023';
  end if;

  insert into public.stock_balances (
    business_id, stock_location_id, stock_item_id, quantity
  )
  values (p_business_id, p_stock_location_id, p_stock_item_id, 0)
  on conflict (stock_location_id, stock_item_id) do nothing;

  select quantity
    into v_before
    from public.stock_balances
    where stock_location_id = p_stock_location_id
      and stock_item_id = p_stock_item_id
    for update;

  v_after := v_before + p_quantity_delta;

  if v_after < 0 then
    raise exception 'Adjustment cannot reduce stock below zero'
      using errcode = '23514';
  end if;

  update public.stock_balances
    set quantity = v_after, updated_at = now()
    where stock_location_id = p_stock_location_id
      and stock_item_id = p_stock_item_id;

  if p_quantity_delta > 0 then
    insert into public.stock_batches (
      business_id, stock_item_id, stock_location_id,
      batch_number, initial_quantity, remaining_quantity
    )
    values (
      p_business_id, p_stock_item_id, p_stock_location_id,
      'Adjustment ' || v_reference_id::text, p_quantity_delta, p_quantity_delta
    );
  else
    perform public.move_stock_batches(
      p_business_id,
      p_stock_item_id,
      p_stock_location_id,
      abs(p_quantity_delta)
    );
  end if;

  v_movement_type := case
    when p_is_wastage then 'wastage'::public.stock_movement_type
    when p_quantity_delta > 0 then 'adjustment_in'::public.stock_movement_type
    else 'adjustment_out'::public.stock_movement_type
  end;

  insert into public.stock_movements (
    business_id, stock_item_id, stock_location_id, movement_type,
    quantity_delta, quantity_before, quantity_after, reference_type,
    reference_id, actor_user_id, reason
  )
  values (
    p_business_id, p_stock_item_id, p_stock_location_id, v_movement_type,
    p_quantity_delta, v_before, v_after, 'stock_adjustment',
    v_reference_id, auth.uid(), btrim(p_reason)
  )
  returning id into v_movement_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  )
  values (
    p_business_id,
    auth.uid(),
    'stock.' || v_movement_type::text,
    'stock_movement',
    v_movement_id::text,
    jsonb_build_object(
      'stock_item_id', p_stock_item_id,
      'stock_location_id', p_stock_location_id,
      'quantity_delta', p_quantity_delta,
      'reason', btrim(p_reason)
    )
  );

  return v_movement_id;
end;
$$;

revoke all on function public.create_supplier(uuid, text, text, text, text, text)
  from public, anon;
revoke all on function public.create_stock_item(uuid, text, text, text, numeric)
  from public, anon;
revoke all on function public.receive_stock(
  uuid, uuid, uuid, uuid, numeric, numeric, uuid, text, date, text
) from public, anon;
revoke all on function public.request_stock(uuid, uuid, jsonb, text)
  from public, anon;
revoke all on function public.review_stock_request(uuid, jsonb, boolean, text)
  from public, anon;
revoke all on function public.issue_stock_request(uuid, jsonb)
  from public, anon;
revoke all on function public.adjust_stock(uuid, uuid, uuid, numeric, text, boolean)
  from public, anon;

grant execute on function public.create_supplier(uuid, text, text, text, text, text)
  to authenticated;
grant execute on function public.create_stock_item(uuid, text, text, text, numeric)
  to authenticated;
grant execute on function public.receive_stock(
  uuid, uuid, uuid, uuid, numeric, numeric, uuid, text, date, text
) to authenticated;
grant execute on function public.request_stock(uuid, uuid, jsonb, text)
  to authenticated;
grant execute on function public.review_stock_request(uuid, jsonb, boolean, text)
  to authenticated;
grant execute on function public.issue_stock_request(uuid, jsonb)
  to authenticated;
grant execute on function public.adjust_stock(uuid, uuid, uuid, numeric, text, boolean)
  to authenticated;

alter table public.suppliers enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_locations enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_requests enable row level security;
alter table public.stock_request_items enable row level security;
alter table public.stock_receipts enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "Inventory managers read business suppliers" on public.suppliers;
create policy "Inventory managers read business suppliers"
  on public.suppliers for select to authenticated
  using ((select public.has_business_permission(business_id, 'inventory.view')));

drop policy if exists "Inventory managers read business stock items" on public.stock_items;
create policy "Inventory managers read business stock items"
  on public.stock_items for select to authenticated
  using ((select public.has_business_permission(business_id, 'inventory.view')));

drop policy if exists "Members read authorized stock locations" on public.stock_locations;
create policy "Members read authorized stock locations"
  on public.stock_locations for select to authenticated
  using (
    (
      location_type = 'central'
      and (select public.has_business_permission(business_id, 'inventory.manage'))
    )
    or (
      location_type = 'department'
      and department_id is not null
      and (
        (select public.has_business_permission(business_id, 'inventory.manage'))
        or (select public.has_department_permission(
          business_id, department_id, 'inventory.view'
        ))
      )
    )
  );

drop policy if exists "Members read authorized stock balances" on public.stock_balances;
create policy "Members read authorized stock balances"
  on public.stock_balances for select to authenticated
  using (
    exists (
      select 1
      from public.stock_locations l
      where l.id = stock_location_id
        and l.business_id = stock_balances.business_id
        and (
          (
            l.location_type = 'central'
            and (select public.has_business_permission(
              stock_balances.business_id, 'inventory.manage'
            ))
          )
          or (
            l.location_type = 'department'
            and l.department_id is not null
            and (
              (select public.has_business_permission(
                stock_balances.business_id, 'inventory.manage'
              ))
              or (select public.has_department_permission(
                stock_balances.business_id, l.department_id, 'inventory.view'
              ))
            )
          )
        )
    )
  );

drop policy if exists "Requesters and stock managers read requests" on public.stock_requests;
create policy "Requesters and stock managers read requests"
  on public.stock_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or (select public.has_business_permission(
      business_id, 'inventory.requests.review'
    ))
    or (select public.has_department_permission(
      business_id, department_id, 'inventory.request'
    ))
  );

drop policy if exists "Requesters and stock managers read request items" on public.stock_request_items;
create policy "Requesters and stock managers read request items"
  on public.stock_request_items for select to authenticated
  using (
    exists (
      select 1
      from public.stock_requests r
      where r.id = request_id
        and r.business_id = stock_request_items.business_id
        and (
          r.requested_by = (select auth.uid())
          or (select public.has_business_permission(
            r.business_id, 'inventory.requests.review'
          ))
          or (select public.has_department_permission(
            r.business_id, r.department_id, 'inventory.request'
          ))
        )
    )
  );

drop policy if exists "Inventory managers read stock receipts" on public.stock_receipts;
create policy "Inventory managers read stock receipts"
  on public.stock_receipts for select to authenticated
  using ((select public.has_business_permission(business_id, 'inventory.manage')));

drop policy if exists "Members read authorized batches" on public.stock_batches;
create policy "Members read authorized batches"
  on public.stock_batches for select to authenticated
  using (
    exists (
      select 1
      from public.stock_locations l
      where l.id = stock_location_id
        and l.business_id = stock_batches.business_id
        and (
          (l.location_type = 'central'
            and (select public.has_business_permission(
              stock_batches.business_id, 'inventory.manage'
            )))
          or (l.location_type = 'department'
            and l.department_id is not null
            and (
              (select public.has_business_permission(
                stock_batches.business_id, 'inventory.manage'
              ))
              or (select public.has_department_permission(
                stock_batches.business_id, l.department_id, 'inventory.view'
              ))
            ))
        )
    )
  );

drop policy if exists "Members read authorized stock movements" on public.stock_movements;
create policy "Members read authorized stock movements"
  on public.stock_movements for select to authenticated
  using (
    exists (
      select 1
      from public.stock_locations l
      where l.id = stock_location_id
        and l.business_id = stock_movements.business_id
        and (
          (l.location_type = 'central'
            and (select public.has_business_permission(
              stock_movements.business_id, 'inventory.manage'
            )))
          or (l.location_type = 'department'
            and l.department_id is not null
            and (
              (select public.has_business_permission(
                stock_movements.business_id, 'inventory.manage'
              ))
              or (select public.has_department_permission(
                stock_movements.business_id, l.department_id, 'inventory.view'
              ))
            ))
        )
    )
  );

revoke all on public.suppliers,
  public.stock_items,
  public.stock_locations,
  public.stock_balances,
  public.stock_requests,
  public.stock_request_items,
  public.stock_receipts,
  public.stock_batches,
  public.stock_movements
from anon, authenticated;

grant select on public.suppliers,
  public.stock_items,
  public.stock_locations,
  public.stock_balances,
  public.stock_requests,
  public.stock_request_items,
  public.stock_receipts,
  public.stock_batches,
  public.stock_movements
to authenticated;
grant select on sequence public.stock_movements_id_seq to authenticated;
