create type public.business_type as enum (
  'hotel',
  'restaurant',
  'bar',
  'lounge',
  'hotel_restaurant'
);

create type public.application_status as enum (
  'submitted',
  'under_review',
  'approved',
  'rejected'
);

create type public.business_status as enum ('active', 'suspended');
create type public.membership_status as enum ('invited', 'active', 'suspended');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users (id) on delete restrict,
  business_name text not null check (char_length(business_name) between 2 and 160),
  business_type public.business_type not null,
  country text not null check (char_length(country) between 2 and 100),
  location text not null check (char_length(location) between 2 and 240),
  contact_email text not null check (char_length(contact_email) between 3 and 254),
  contact_phone text not null check (char_length(contact_phone) between 5 and 40),
  registration_number text check (
    registration_number is null or char_length(registration_number) <= 100
  ),
  status public.application_status not null default 'submitted',
  review_notes text check (review_notes is null or char_length(review_notes) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_application_review_state check (
    (status in ('submitted', 'under_review') and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);

create unique index business_applications_one_open_per_applicant
  on public.business_applications (applicant_user_id)
  where status in ('submitted', 'under_review');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  business_code text not null unique default (
    'SGR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique,
  business_type public.business_type not null,
  country text not null,
  location text not null,
  contact_email text not null,
  contact_phone text not null,
  registration_number text,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  status public.business_status not null default 'active',
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  status public.membership_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_memberships_user_status_idx
  on public.business_memberships (user_id, status);

create table public.roles (
  role_key text primary key,
  label text not null unique
);

create table public.permissions (
  permission_key text primary key,
  description text not null
);

create table public.role_permissions (
  role_key text not null references public.roles (role_key) on delete cascade,
  permission_key text not null references public.permissions (permission_key) on delete cascade,
  primary key (role_key, permission_key)
);

create table public.membership_roles (
  membership_id uuid not null references public.business_memberships (id) on delete restrict,
  role_key text not null references public.roles (role_key) on delete restrict,
  assigned_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_key)
);

create table public.platform_user_roles (
  user_id uuid not null references auth.users (id) on delete restrict,
  role_key text not null check (role_key = 'system_admin'),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  department_key text not null check (
    department_key in ('management', 'kitchen', 'bar', 'stock', 'cashier', 'service')
  ),
  name text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, department_key)
);

create table public.business_settings (
  business_id uuid primary key references public.businesses (id) on delete restrict,
  currency_code text not null default 'UGX' check (currency_code ~ '^[A-Z]{3}$'),
  timezone text not null default 'Africa/Kampala',
  tax_rate numeric(7, 4) not null default 0 check (tax_rate between 0 and 100),
  service_charge_rate numeric(7, 4) not null default 0
    check (service_charge_rate between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid references public.businesses (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_business_created_idx
  on public.audit_logs (business_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_user_roles pur
    where pur.user_id = (select auth.uid())
      and pur.role_key = 'system_admin'
  );
$$;

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
    join public.membership_roles mr on mr.membership_id = bm.id
    join public.role_permissions rp on rp.role_key = mr.role_key
    where bm.business_id = p_business_id
      and bm.user_id = (select auth.uid())
      and bm.status = 'active'
      and rp.permission_key = p_permission_key
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.has_business_permission(uuid, text) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_business_permission(uuid, text) to authenticated;

create or replace function public.review_business_application(
  p_application_id uuid,
  p_decision public.application_status,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.business_applications%rowtype;
  v_business_id uuid;
  v_membership_id uuid;
  v_business_slug text;
  v_name_slug text;
  v_department record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform administrator permission required' using errcode = '42501';
  end if;

  select *
    into v_application
    from public.business_applications
    where id = p_application_id
    for update;

  if not found then
    raise exception 'Business application not found' using errcode = 'P0002';
  end if;

  if v_application.applicant_user_id = auth.uid() then
    raise exception 'An applicant cannot review their own application'
      using errcode = '42501';
  end if;

  if v_application.status not in ('submitted', 'under_review') then
    raise exception 'Business application has already been reviewed'
      using errcode = '22023';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  if p_review_notes is not null and char_length(p_review_notes) > 2000 then
    raise exception 'Review notes are too long' using errcode = '22023';
  end if;

  update public.business_applications
    set status = p_decision,
        review_notes = nullif(btrim(p_review_notes), ''),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_application_id;

  if p_decision = 'approved' then
    v_name_slug := trim(both '-' from regexp_replace(
      lower(v_application.business_name),
      '[^a-z0-9]+',
      '-',
      'g'
    ));
    v_business_slug := coalesce(nullif(v_name_slug, ''), 'business')
      || '-'
      || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

    insert into public.businesses (
      name,
      slug,
      business_type,
      country,
      location,
      contact_email,
      contact_phone,
      registration_number,
      owner_user_id,
      created_by
    )
    values (
      v_application.business_name,
      v_business_slug,
      v_application.business_type,
      v_application.country,
      v_application.location,
      v_application.contact_email,
      v_application.contact_phone,
      v_application.registration_number,
      v_application.applicant_user_id,
      auth.uid()
    )
    returning id into v_business_id;

    insert into public.business_settings (business_id)
    values (v_business_id);

    insert into public.business_memberships (business_id, user_id, status, invited_by)
    values (v_business_id, v_application.applicant_user_id, 'active', auth.uid())
    returning id into v_membership_id;

    insert into public.membership_roles (membership_id, role_key, assigned_by)
    values (v_membership_id, 'business_owner', auth.uid());

    for v_department in
      select department_key, name
      from (values
        ('management', 'Management'),
        ('kitchen', 'Kitchen'),
        ('bar', 'Bar'),
        ('stock', 'Stock'),
        ('cashier', 'Cashier'),
        ('service', 'Service')
      ) as defaults(department_key, name)
    loop
      insert into public.departments (business_id, department_key, name)
      values (v_business_id, v_department.department_key, v_department.name);
    end loop;
  end if;

  insert into public.audit_logs (
    business_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    v_business_id,
    auth.uid(),
    'business_application.' || p_decision::text,
    'business_application',
    p_application_id::text,
    jsonb_build_object('status', p_decision::text)
  );

  return v_business_id;
end;
$$;

revoke all on function public.review_business_application(
  uuid, public.application_status, text
) from public, anon;
grant execute on function public.review_business_application(
  uuid, public.application_status, text
) to authenticated;

insert into public.roles (role_key, label) values
  ('business_owner', 'Business owner'),
  ('hotel_manager', 'Hotel manager'),
  ('kitchen_manager', 'Kitchen manager'),
  ('kitchen_staff', 'Kitchen staff'),
  ('bar_manager', 'Bar manager'),
  ('bartender', 'Bartender'),
  ('stock_manager', 'Stock manager'),
  ('cashier', 'Cashier'),
  ('server', 'Server');

insert into public.permissions (permission_key, description) values
  ('business.view', 'View business workspace information'),
  ('business.manage', 'Manage business configuration'),
  ('staff.view', 'View business staff and memberships'),
  ('staff.manage', 'Manage business staff and role assignments'),
  ('departments.manage', 'Manage enabled business departments'),
  ('menu.manage', 'Manage the business menu'),
  ('inventory.view', 'View department inventory'),
  ('inventory.manage', 'Manage inventory and stock movements'),
  ('kitchen.manage', 'Manage kitchen tickets and assignments'),
  ('kitchen.prepare', 'Prepare and update kitchen tickets'),
  ('bar.manage', 'Manage bar tickets and assignments'),
  ('bar.prepare', 'Prepare and update bar tickets'),
  ('orders.view', 'View customer orders'),
  ('orders.manage', 'Manage orders and department tickets'),
  ('service.confirm', 'Confirm delivery of assigned orders'),
  ('payments.manage', 'Manage payment verification and cashier sessions'),
  ('shifts.manage', 'Manage staff shifts and attendance'),
  ('reports.view', 'View business reports'),
  ('audit.view', 'View business audit history');

insert into public.role_permissions (role_key, permission_key)
select r.role_key, p.permission_key
from public.roles r
cross join public.permissions p
where r.role_key in ('business_owner', 'hotel_manager');

insert into public.role_permissions (role_key, permission_key) values
  ('kitchen_manager', 'business.view'),
  ('kitchen_manager', 'inventory.view'),
  ('kitchen_manager', 'kitchen.manage'),
  ('kitchen_manager', 'orders.view'),
  ('kitchen_manager', 'orders.manage'),
  ('kitchen_manager', 'reports.view'),
  ('kitchen_staff', 'business.view'),
  ('kitchen_staff', 'kitchen.prepare'),
  ('bar_manager', 'business.view'),
  ('bar_manager', 'inventory.view'),
  ('bar_manager', 'bar.manage'),
  ('bar_manager', 'orders.view'),
  ('bar_manager', 'orders.manage'),
  ('bar_manager', 'reports.view'),
  ('bartender', 'business.view'),
  ('bartender', 'inventory.view'),
  ('bartender', 'bar.prepare'),
  ('stock_manager', 'business.view'),
  ('stock_manager', 'inventory.view'),
  ('stock_manager', 'inventory.manage'),
  ('stock_manager', 'reports.view'),
  ('cashier', 'business.view'),
  ('cashier', 'orders.view'),
  ('cashier', 'payments.manage'),
  ('cashier', 'reports.view'),
  ('server', 'business.view'),
  ('server', 'orders.view'),
  ('server', 'service.confirm');

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger business_applications_set_updated_at
  before update on public.business_applications
  for each row execute function public.set_updated_at();

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

create trigger business_memberships_set_updated_at
  before update on public.business_memberships
  for each row execute function public.set_updated_at();

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

create trigger business_settings_set_updated_at
  before update on public.business_settings
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.business_applications enable row level security;
alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.membership_roles enable row level security;
alter table public.platform_user_roles enable row level security;
alter table public.departments enable row level security;
alter table public.business_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Applicants and platform admins read applications"
  on public.business_applications for select to authenticated
  using (
    applicant_user_id = (select auth.uid())
    or (select public.is_platform_admin())
  );

create policy "Users submit their own applications"
  on public.business_applications for insert to authenticated
  with check (
    applicant_user_id = (select auth.uid())
    and status = 'submitted'
    and reviewed_by is null
    and reviewed_at is null
    and review_notes is null
  );

create policy "Members read their authorized businesses"
  on public.businesses for select to authenticated
  using (
    (select public.is_platform_admin())
    or (select public.has_business_permission(id, 'business.view'))
  );

create policy "Business managers update business details"
  on public.businesses for update to authenticated
  using ((select public.has_business_permission(id, 'business.manage')))
  with check ((select public.has_business_permission(id, 'business.manage')));

create policy "Users read their own memberships or authorized staff"
  on public.business_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_platform_admin())
    or (select public.has_business_permission(business_id, 'staff.view'))
  );

create policy "Authenticated users read role catalog"
  on public.roles for select to authenticated
  using (true);

create policy "Authenticated users read permission catalog"
  on public.permissions for select to authenticated
  using (true);

create policy "Authenticated users read role permissions"
  on public.role_permissions for select to authenticated
  using (true);

create policy "Users read their own roles or authorized staff roles"
  on public.membership_roles for select to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.id = membership_id
        and (
          bm.user_id = (select auth.uid())
          or (select public.is_platform_admin())
          or (select public.has_business_permission(bm.business_id, 'staff.view'))
        )
    )
  );

create policy "Platform admins read platform roles"
  on public.platform_user_roles for select to authenticated
  using ((select public.is_platform_admin()));

create policy "Members read authorized departments"
  on public.departments for select to authenticated
  using (
    (select public.is_platform_admin())
    or (select public.has_business_permission(business_id, 'business.view'))
  );

create policy "Business managers manage departments"
  on public.departments for update to authenticated
  using ((select public.has_business_permission(business_id, 'departments.manage')))
  with check ((select public.has_business_permission(business_id, 'departments.manage')));

create policy "Members read business settings"
  on public.business_settings for select to authenticated
  using (
    (select public.is_platform_admin())
    or (select public.has_business_permission(business_id, 'business.view'))
  );

create policy "Business managers update business settings"
  on public.business_settings for update to authenticated
  using ((select public.has_business_permission(business_id, 'business.manage')))
  with check ((select public.has_business_permission(business_id, 'business.manage')));

create policy "Authorized managers read audit logs"
  on public.audit_logs for select to authenticated
  using (
    (select public.is_platform_admin())
    or (
      business_id is not null
      and (select public.has_business_permission(business_id, 'audit.view'))
    )
  );

revoke all on public.profiles,
  public.business_applications,
  public.businesses,
  public.business_memberships,
  public.roles,
  public.permissions,
  public.role_permissions,
  public.membership_roles,
  public.platform_user_roles,
  public.departments,
  public.business_settings,
  public.audit_logs
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select, insert on public.business_applications to authenticated;
grant select on public.businesses to authenticated;
grant update (
  name,
  slug,
  business_type,
  country,
  location,
  contact_email,
  contact_phone,
  registration_number
) on public.businesses to authenticated;
grant select on public.business_memberships to authenticated;
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant select on public.membership_roles, public.platform_user_roles to authenticated;
grant select on public.departments, public.business_settings to authenticated;
grant update (name, is_enabled) on public.departments to authenticated;
grant update (currency_code, timezone, tax_rate, service_charge_rate)
  on public.business_settings to authenticated;
grant select on public.audit_logs to authenticated;
