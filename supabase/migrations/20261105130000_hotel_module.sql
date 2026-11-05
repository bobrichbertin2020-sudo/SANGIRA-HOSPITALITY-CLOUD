-- Hotel module: switchable per business. Rooms, reservations, check-in and
-- check-out, guest folio (charges and payments), housekeeping and maintenance.
-- All writes go through the functions below; tables are read-only for staff.

alter table public.business_settings
  add column if not exists hotel_enabled boolean not null default false;

alter table public.departments
  drop constraint if exists departments_department_key_check;
alter table public.departments
  add constraint departments_department_key_check check (
    department_key in (
      'management', 'kitchen', 'bar', 'stock', 'cashier', 'service',
      'front_desk', 'housekeeping'
    )
  );

insert into public.roles (role_key, label) values
  ('receptionist', 'Receptionist'),
  ('housekeeper', 'Housekeeper')
on conflict (role_key) do nothing;

insert into public.permissions (permission_key, description) values
  ('hotel.view', 'View rooms, reservations and housekeeping'),
  ('hotel.frontdesk', 'Manage reservations, check-in, check-out and the guest folio'),
  ('hotel.housekeeping', 'Update room cleaning status and maintenance work'),
  ('hotel.manage', 'Configure rooms and rates')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_key, permission_key) values
  ('business_owner', 'hotel.view'),
  ('business_owner', 'hotel.frontdesk'),
  ('business_owner', 'hotel.housekeeping'),
  ('business_owner', 'hotel.manage'),
  ('hotel_manager', 'hotel.view'),
  ('hotel_manager', 'hotel.frontdesk'),
  ('hotel_manager', 'hotel.housekeeping'),
  ('hotel_manager', 'hotel.manage'),
  ('receptionist', 'business.view'),
  ('receptionist', 'hotel.view'),
  ('receptionist', 'hotel.frontdesk'),
  ('housekeeper', 'business.view'),
  ('housekeeper', 'hotel.view'),
  ('housekeeper', 'hotel.housekeeping')
on conflict (role_key, permission_key) do nothing;

create type public.room_status as enum (
  'vacant_clean', 'vacant_dirty', 'occupied', 'out_of_service'
);
create type public.reservation_status as enum (
  'reserved', 'checked_in', 'checked_out', 'cancelled'
);
create type public.maintenance_status as enum ('open', 'in_progress', 'resolved');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  room_number text not null check (char_length(btrim(room_number)) between 1 and 20),
  room_type text not null check (char_length(btrim(room_type)) between 2 and 60),
  capacity integer not null default 2 check (capacity between 1 and 20),
  nightly_rate numeric(14, 2) not null check (nightly_rate >= 0),
  status public.room_status not null default 'vacant_clean',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, room_number)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  reservation_code text not null default (
    'RES-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  room_id uuid not null,
  guest_name text not null check (char_length(btrim(guest_name)) between 2 and 120),
  guest_phone text check (guest_phone is null or char_length(guest_phone) <= 40),
  guest_count integer not null default 1 check (guest_count between 1 and 20),
  check_in_date date not null,
  check_out_date date not null,
  nightly_rate numeric(14, 2) not null check (nightly_rate >= 0),
  status public.reservation_status not null default 'reserved',
  notes text check (notes is null or char_length(notes) <= 500),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, reservation_code),
  foreign key (room_id, business_id)
    references public.rooms (id, business_id) on delete restrict,
  check (check_out_date > check_in_date and check_out_date - check_in_date <= 90)
);

create index reservations_business_dates_idx
  on public.reservations (business_id, check_in_date, check_out_date);
create index reservations_room_idx on public.reservations (room_id, status);

create table public.folio_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  reservation_id uuid not null,
  description text not null check (char_length(btrim(description)) between 2 and 160),
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (reservation_id, business_id)
    references public.reservations (id, business_id) on delete restrict
);

create table public.folio_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  reservation_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'mobile_money', 'card', 'bank')),
  reference text check (reference is null or char_length(reference) <= 120),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (reservation_id, business_id)
    references public.reservations (id, business_id) on delete restrict
);

create index folio_charges_reservation_idx on public.folio_charges (reservation_id);
create index folio_payments_reservation_idx on public.folio_payments (reservation_id);

create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  room_id uuid not null,
  description text not null check (char_length(btrim(description)) between 3 and 500),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  blocks_room boolean not null default false,
  status public.maintenance_status not null default 'open',
  reported_by uuid not null references auth.users (id) on delete restrict,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (room_id, business_id)
    references public.rooms (id, business_id) on delete restrict
);

create index maintenance_business_status_idx
  on public.maintenance_requests (business_id, status, created_at desc);

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at before update on public.rooms
  for each row execute function public.set_updated_at();
drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();

alter table public.rooms enable row level security;
alter table public.reservations enable row level security;
alter table public.folio_charges enable row level security;
alter table public.folio_payments enable row level security;
alter table public.maintenance_requests enable row level security;

create policy "Hotel staff read rooms" on public.rooms
  for select to authenticated
  using ((select public.has_business_permission(business_id, 'hotel.view')));
create policy "Front desk reads reservations" on public.reservations
  for select to authenticated
  using ((select public.has_business_permission(business_id, 'hotel.frontdesk')));
create policy "Front desk reads folio charges" on public.folio_charges
  for select to authenticated
  using ((select public.has_business_permission(business_id, 'hotel.frontdesk')));
create policy "Front desk reads folio payments" on public.folio_payments
  for select to authenticated
  using ((select public.has_business_permission(business_id, 'hotel.frontdesk')));
create policy "Hotel staff read maintenance" on public.maintenance_requests
  for select to authenticated
  using ((select public.has_business_permission(business_id, 'hotel.view')));

revoke all on public.rooms, public.reservations, public.folio_charges,
  public.folio_payments, public.maintenance_requests from anon, authenticated;
grant select on public.rooms, public.reservations, public.folio_charges,
  public.folio_payments, public.maintenance_requests to authenticated;

create or replace function public.audit_hotel(
  p_business_id uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), p_action, p_entity, p_entity_id::text, p_details
  );
$$;
revoke all on function public.audit_hotel(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.set_hotel_module(p_business_id uuid, p_enabled boolean)
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

  update public.business_settings
    set hotel_enabled = coalesce(p_enabled, false)
    where business_id = p_business_id;

  if coalesce(p_enabled, false) then
    insert into public.departments (business_id, department_key, name)
    values
      (p_business_id, 'front_desk', 'Front desk'),
      (p_business_id, 'housekeeping', 'Housekeeping')
    on conflict (business_id, department_key) do update set is_enabled = true;
  end if;

  perform public.audit_hotel(
    p_business_id, 'business.hotel_module', 'business', p_business_id,
    jsonb_build_object('enabled', coalesce(p_enabled, false))
  );
end;
$$;

create or replace function public.hotel_is_enabled(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.hotel_enabled from public.business_settings s
    where s.business_id = p_business_id
  ), false);
$$;
revoke all on function public.hotel_is_enabled(uuid) from public, anon, authenticated;

create or replace function public.create_room(
  p_business_id uuid, p_room_number text, p_room_type text,
  p_capacity integer, p_nightly_rate numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'hotel.manage') then
    raise exception 'Hotel management permission required' using errcode = '42501';
  end if;
  if not public.hotel_is_enabled(p_business_id) then
    raise exception 'Turn on the hotel module first' using errcode = '22023';
  end if;
  if p_nightly_rate is null or p_nightly_rate < 0
     or p_nightly_rate <> round(p_nightly_rate, 2)
     or p_capacity not between 1 and 20 then
    raise exception 'Enter a valid rate and capacity' using errcode = '22023';
  end if;

  insert into public.rooms (business_id, room_number, room_type, capacity, nightly_rate)
  values (p_business_id, btrim(p_room_number), btrim(p_room_type), p_capacity, p_nightly_rate)
  returning id into v_id;

  perform public.audit_hotel(
    p_business_id, 'room.created', 'room', v_id,
    jsonb_build_object('room_number', btrim(p_room_number))
  );
  return v_id;
end;
$$;

create or replace function public.create_reservation(
  p_business_id uuid, p_room_id uuid, p_guest_name text, p_guest_phone text,
  p_guest_count integer, p_check_in date, p_check_out date, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'hotel.frontdesk') then
    raise exception 'Front desk permission required' using errcode = '42501';
  end if;
  if not public.hotel_is_enabled(p_business_id) then
    raise exception 'The hotel module is not enabled' using errcode = '22023';
  end if;

  select * into v_room from public.rooms
    where id = p_room_id and business_id = p_business_id and is_active
    for update;
  if not found then
    raise exception 'Choose an active room' using errcode = '22023';
  end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in
     or p_check_out - p_check_in > 90 then
    raise exception 'Check-out must be after check-in (up to 90 nights)'
      using errcode = '22023';
  end if;
  if p_guest_count is null or p_guest_count not between 1 and v_room.capacity then
    raise exception 'This room sleeps up to % guests', v_room.capacity
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.reservations r
    where r.room_id = p_room_id and r.status in ('reserved', 'checked_in')
      and r.check_in_date < p_check_out and r.check_out_date > p_check_in
  ) then
    raise exception 'That room is already booked for those dates' using errcode = '22023';
  end if;

  insert into public.reservations (
    business_id, room_id, guest_name, guest_phone, guest_count,
    check_in_date, check_out_date, nightly_rate, notes, created_by
  ) values (
    p_business_id, p_room_id, btrim(p_guest_name), nullif(btrim(p_guest_phone), ''),
    p_guest_count, p_check_in, p_check_out, v_room.nightly_rate,
    nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_id;

  perform public.audit_hotel(
    p_business_id, 'reservation.created', 'reservation', v_id,
    jsonb_build_object('room', v_room.room_number, 'check_in', p_check_in,
      'check_out', p_check_out)
  );
  return v_id;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_res.business_id, 'hotel.frontdesk') then
    raise exception 'Front desk permission required' using errcode = '42501';
  end if;
  if v_res.status <> 'reserved' then
    raise exception 'Only a reservation that has not checked in can be cancelled'
      using errcode = '22023';
  end if;
  update public.reservations set status = 'cancelled' where id = p_reservation_id;
  perform public.audit_hotel(
    v_res.business_id, 'reservation.cancelled', 'reservation', p_reservation_id,
    jsonb_build_object('code', v_res.reservation_code)
  );
end;
$$;

create or replace function public.check_in_guest(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_room public.rooms%rowtype;
  v_today date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_res.business_id, 'hotel.frontdesk') then
    raise exception 'Front desk permission required' using errcode = '42501';
  end if;
  if v_res.status <> 'reserved' then
    raise exception 'This reservation is not waiting to check in' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(
    (select s.timezone from public.business_settings s
     where s.business_id = v_res.business_id), 'UTC'))::date into v_today;
  if v_res.check_in_date > v_today then
    raise exception 'Guests can only check in on or after the arrival date'
      using errcode = '22023';
  end if;
  if v_res.check_out_date <= v_today then
    raise exception 'This reservation has already ended' using errcode = '22023';
  end if;

  select * into v_room from public.rooms where id = v_res.room_id for update;
  if v_room.status = 'occupied' then
    raise exception 'Room % still has a guest in it', v_room.room_number
      using errcode = '22023';
  end if;
  if v_room.status = 'out_of_service' then
    raise exception 'Room % is out of service', v_room.room_number using errcode = '22023';
  end if;
  if v_room.status = 'vacant_dirty' then
    raise exception 'Room % has not been cleaned yet', v_room.room_number
      using errcode = '22023';
  end if;

  update public.reservations
    set status = 'checked_in', checked_in_at = now() where id = p_reservation_id;
  update public.rooms set status = 'occupied' where id = v_room.id;

  perform public.audit_hotel(
    v_res.business_id, 'reservation.checked_in', 'reservation', p_reservation_id,
    jsonb_build_object('room', v_room.room_number)
  );
end;
$$;

create or replace function public.add_folio_charge(
  p_reservation_id uuid, p_description text, p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_res.business_id, 'hotel.frontdesk') then
    raise exception 'Front desk permission required' using errcode = '42501';
  end if;
  if v_res.status <> 'checked_in' then
    raise exception 'Charges can only be added while the guest is checked in'
      using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid amount' using errcode = '22023';
  end if;

  insert into public.folio_charges (
    business_id, reservation_id, description, amount, created_by
  ) values (
    v_res.business_id, p_reservation_id, btrim(p_description), p_amount, auth.uid()
  );
  perform public.audit_hotel(
    v_res.business_id, 'folio.charge_added', 'reservation', p_reservation_id,
    jsonb_build_object('description', btrim(p_description), 'amount', p_amount)
  );
end;
$$;

create or replace function public.record_folio_payment(
  p_reservation_id uuid, p_amount numeric, p_method text, p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_due numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_res.business_id, 'hotel.frontdesk') then
    raise exception 'Front desk permission required' using errcode = '42501';
  end if;
  if v_res.status not in ('reserved', 'checked_in') then
    raise exception 'This stay is no longer open for payments' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_method not in ('cash', 'mobile_money', 'card', 'bank') then
    raise exception 'Enter a valid amount and method' using errcode = '22023';
  end if;

  v_due := (v_res.check_out_date - v_res.check_in_date) * v_res.nightly_rate
    + coalesce((select sum(c.amount) from public.folio_charges c
                where c.reservation_id = p_reservation_id), 0)
    - coalesce((select sum(p.amount) from public.folio_payments p
                where p.reservation_id = p_reservation_id), 0);
  if p_amount > v_due then
    raise exception 'That is more than the balance of %', v_due using errcode = '22023';
  end if;

  insert into public.folio_payments (
    business_id, reservation_id, amount, method, reference, created_by
  ) values (
    v_res.business_id, p_reservation_id, p_amount, p_method,
    nullif(btrim(p_reference), ''), auth.uid()
  );
  perform public.audit_hotel(
    v_res.business_id, 'folio.payment_recorded', 'reservation', p_reservation_id,
    jsonb_build_object('amount', p_amount, 'method', p_method)
  );
end;
$$;

create or replace function public.check_out_guest(
  p_reservation_id uuid, p_allow_unpaid boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_due numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_res.business_id, 'hotel.frontdesk') then
    raise exception 'Front desk permission required' using errcode = '42501';
  end if;
  if v_res.status <> 'checked_in' then
    raise exception 'This guest is not checked in' using errcode = '22023';
  end if;

  v_due := (v_res.check_out_date - v_res.check_in_date) * v_res.nightly_rate
    + coalesce((select sum(c.amount) from public.folio_charges c
                where c.reservation_id = p_reservation_id), 0)
    - coalesce((select sum(p.amount) from public.folio_payments p
                where p.reservation_id = p_reservation_id), 0);

  if v_due > 0 then
    if not coalesce(p_allow_unpaid, false) then
      raise exception 'The guest still owes %. Record payment before check-out.', v_due
        using errcode = '22023';
    end if;
    if not public.has_business_permission(v_res.business_id, 'hotel.manage') then
      raise exception 'Only a manager can check out a guest with an unpaid balance'
        using errcode = '42501';
    end if;
  end if;

  update public.reservations
    set status = 'checked_out', checked_out_at = now() where id = p_reservation_id;
  update public.rooms set status = 'vacant_dirty'
    where id = v_res.room_id and status = 'occupied';

  perform public.audit_hotel(
    v_res.business_id, 'reservation.checked_out', 'reservation', p_reservation_id,
    jsonb_build_object('unpaid_balance', greatest(v_due, 0))
  );
end;
$$;

create or replace function public.mark_room_clean(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;
  if not (
    public.has_business_permission(v_room.business_id, 'hotel.housekeeping')
    or public.has_business_permission(v_room.business_id, 'hotel.manage')
  ) then
    raise exception 'Housekeeping permission required' using errcode = '42501';
  end if;
  if v_room.status <> 'vacant_dirty' then
    raise exception 'Only a dirty vacant room can be marked clean' using errcode = '22023';
  end if;
  update public.rooms set status = 'vacant_clean' where id = p_room_id;
  perform public.audit_hotel(
    v_room.business_id, 'room.cleaned', 'room', p_room_id,
    jsonb_build_object('room', v_room.room_number)
  );
end;
$$;

create or replace function public.report_maintenance(
  p_room_id uuid, p_description text, p_priority text, p_block_room boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_id uuid;
  v_block boolean := coalesce(p_block_room, false);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_room.business_id, 'hotel.view') then
    raise exception 'Hotel access required' using errcode = '42501';
  end if;
  if p_priority not in ('low', 'normal', 'urgent') then
    raise exception 'Choose a valid priority' using errcode = '22023';
  end if;
  if v_block and v_room.status = 'occupied' then
    raise exception 'A room with a guest in it cannot be taken out of service'
      using errcode = '22023';
  end if;

  insert into public.maintenance_requests (
    business_id, room_id, description, priority, blocks_room, reported_by
  ) values (
    v_room.business_id, p_room_id, btrim(p_description), p_priority, v_block, auth.uid()
  ) returning id into v_id;

  if v_block then
    update public.rooms set status = 'out_of_service' where id = p_room_id;
  end if;

  perform public.audit_hotel(
    v_room.business_id, 'maintenance.reported', 'room', p_room_id,
    jsonb_build_object('priority', p_priority, 'blocks_room', v_block)
  );
  return v_id;
end;
$$;

create or replace function public.resolve_maintenance(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.maintenance_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_req from public.maintenance_requests
    where id = p_request_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if not (
    public.has_business_permission(v_req.business_id, 'hotel.housekeeping')
    or public.has_business_permission(v_req.business_id, 'hotel.manage')
  ) then
    raise exception 'Housekeeping permission required' using errcode = '42501';
  end if;
  if v_req.status = 'resolved' then
    raise exception 'Already resolved' using errcode = '22023';
  end if;

  update public.maintenance_requests
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where id = p_request_id;

  -- Back into circulation as dirty once no other blocking issue remains.
  if not exists (
    select 1 from public.maintenance_requests m
    where m.room_id = v_req.room_id and m.blocks_room and m.status <> 'resolved'
  ) then
    update public.rooms set status = 'vacant_dirty'
      where id = v_req.room_id and status = 'out_of_service';
  end if;

  perform public.audit_hotel(
    v_req.business_id, 'maintenance.resolved', 'room', v_req.room_id,
    jsonb_build_object('request_id', p_request_id)
  );
end;
$$;

revoke all on function
  public.set_hotel_module(uuid, boolean),
  public.create_room(uuid, text, text, integer, numeric),
  public.create_reservation(uuid, uuid, text, text, integer, date, date, text),
  public.cancel_reservation(uuid),
  public.check_in_guest(uuid),
  public.add_folio_charge(uuid, text, numeric),
  public.record_folio_payment(uuid, numeric, text, text),
  public.check_out_guest(uuid, boolean),
  public.mark_room_clean(uuid),
  public.report_maintenance(uuid, text, text, boolean),
  public.resolve_maintenance(uuid)
  from public, anon;
grant execute on function
  public.set_hotel_module(uuid, boolean),
  public.create_room(uuid, text, text, integer, numeric),
  public.create_reservation(uuid, uuid, text, text, integer, date, date, text),
  public.cancel_reservation(uuid),
  public.check_in_guest(uuid),
  public.add_folio_charge(uuid, text, numeric),
  public.record_folio_payment(uuid, numeric, text, text),
  public.check_out_guest(uuid, boolean),
  public.mark_room_clean(uuid),
  public.report_maintenance(uuid, text, text, boolean),
  public.resolve_maintenance(uuid)
  to authenticated;
