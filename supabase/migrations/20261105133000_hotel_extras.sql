-- Hotel extras: change stay dates, room-service charging to the guest bill,
-- and a hotel snapshot for the manager's Today page.

create table public.order_room_charges (
  order_id uuid primary key references public.orders (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  reservation_id uuid not null references public.reservations (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.order_room_charges enable row level security;
create policy "Front desk reads room charges" on public.order_room_charges
  for select to authenticated
  using ((select public.has_business_permission(business_id, 'hotel.frontdesk')));
revoke all on public.order_room_charges from anon, authenticated;
grant select on public.order_room_charges to authenticated;

-- A room-charged order was never paid in cash, so it must not be refunded in cash.
create or replace function public.block_refund_on_room_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.order_room_charges c where c.order_id = new.order_id) then
    raise exception 'This order was charged to a room. Adjust the guest bill instead of refunding.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists refunds_block_room_charge on public.refunds;
create trigger refunds_block_room_charge before insert on public.refunds
  for each row execute function public.block_refund_on_room_charge();

create or replace function public.change_checkout_date(
  p_reservation_id uuid, p_new_check_out date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
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
  if v_res.status not in ('reserved', 'checked_in') then
    raise exception 'This stay can no longer be changed' using errcode = '22023';
  end if;
  if p_new_check_out is null or p_new_check_out <= v_res.check_in_date
     or p_new_check_out - v_res.check_in_date > 90 then
    raise exception 'Check-out must be after check-in (up to 90 nights)'
      using errcode = '22023';
  end if;
  if p_new_check_out = v_res.check_out_date then
    raise exception 'That is already the check-out date' using errcode = '22023';
  end if;

  select (now() at time zone coalesce(
    (select s.timezone from public.business_settings s
     where s.business_id = v_res.business_id), 'UTC'))::date into v_today;
  if v_res.status = 'checked_in' and p_new_check_out < v_today then
    raise exception 'The new check-out date cannot be in the past' using errcode = '22023';
  end if;

  if p_new_check_out > v_res.check_out_date and exists (
    select 1 from public.reservations r
    where r.room_id = v_res.room_id and r.id <> v_res.id
      and r.status in ('reserved', 'checked_in')
      and r.check_in_date < p_new_check_out and r.check_out_date > v_res.check_out_date
  ) then
    raise exception 'The room is booked by another guest during the extension'
      using errcode = '22023';
  end if;

  update public.reservations set check_out_date = p_new_check_out
    where id = p_reservation_id;
  perform public.audit_hotel(
    v_res.business_id, 'reservation.dates_changed', 'reservation', p_reservation_id,
    jsonb_build_object('old_check_out', v_res.check_out_date, 'new_check_out', p_new_check_out)
  );
end;
$$;

create or replace function public.charge_order_to_room(
  p_reservation_id uuid, p_order_code text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations%rowtype;
  v_order public.orders%rowtype;
  v_due numeric(14, 2);
  v_room text;
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
    raise exception 'Orders can only be charged to a guest who is checked in'
      using errcode = '22023';
  end if;

  select * into v_order from public.orders
    where business_id = v_res.business_id
      and upper(order_code) = upper(btrim(coalesce(p_order_code, '')))
    for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'That order is cancelled' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_room_charges c where c.order_id = v_order.id) then
    raise exception 'That order is already charged to a room' using errcode = '22023';
  end if;

  select coalesce(sum(i.unit_price * i.quantity), 0) - v_order.amount_paid
    into v_due
    from public.order_items i
    where i.order_id = v_order.id and i.status <> 'cancelled';
  if v_due <= 0 then
    raise exception 'That order has nothing left to pay' using errcode = '22023';
  end if;

  select room_number into v_room from public.rooms where id = v_res.room_id;

  insert into public.order_room_charges (
    order_id, business_id, reservation_id, amount, created_by
  ) values (v_order.id, v_res.business_id, p_reservation_id, v_due, auth.uid());

  insert into public.folio_charges (
    business_id, reservation_id, description, amount, created_by
  ) values (
    v_res.business_id, p_reservation_id,
    'Room service ' || v_order.order_code, v_due, auth.uid()
  );

  update public.orders set amount_paid = amount_paid + v_due where id = v_order.id;

  perform public.audit_hotel(
    v_res.business_id, 'folio.order_charged', 'reservation', p_reservation_id,
    jsonb_build_object('order', v_order.order_code, 'amount', v_due, 'room', v_room)
  );
  return v_due;
end;
$$;

create or replace function public.hotel_overview(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_start timestamptz;
  v_total int;
  v_occupied int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not (
    public.has_business_permission(p_business_id, 'reports.view')
    or public.has_business_permission(p_business_id, 'hotel.view')
  ) then
    raise exception 'Not allowed to view the hotel overview' using errcode = '42501';
  end if;
  if not public.hotel_is_enabled(p_business_id) then
    return jsonb_build_object('enabled', false);
  end if;

  select coalesce((select s.timezone from public.business_settings s
                   where s.business_id = p_business_id), 'UTC') into v_tz;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;
  v_today := (now() at time zone v_tz)::date;
  v_start := v_today::timestamp at time zone v_tz;

  select count(*), count(*) filter (where status = 'occupied')
    into v_total, v_occupied
    from public.rooms where business_id = p_business_id and is_active;

  return jsonb_build_object(
    'enabled', true,
    'rooms_total', v_total,
    'occupied', v_occupied,
    'occupancy_percent', case when v_total = 0 then 0
                              else round(v_occupied * 100.0 / v_total) end,
    'vacant_clean', (select count(*) from public.rooms
      where business_id = p_business_id and is_active and status = 'vacant_clean'),
    'vacant_dirty', (select count(*) from public.rooms
      where business_id = p_business_id and is_active and status = 'vacant_dirty'),
    'out_of_service', (select count(*) from public.rooms
      where business_id = p_business_id and is_active and status = 'out_of_service'),
    'arrivals_today', (select count(*) from public.reservations
      where business_id = p_business_id and status = 'reserved'
        and check_in_date = v_today),
    'departures_today', (select count(*) from public.reservations
      where business_id = p_business_id and status = 'checked_in'
        and check_out_date <= v_today),
    'in_house', (select count(*) from public.reservations
      where business_id = p_business_id and status = 'checked_in'),
    'folio_payments_today', (select coalesce(sum(amount), 0) from public.folio_payments
      where business_id = p_business_id and created_at >= v_start),
    'open_maintenance', (select count(*) from public.maintenance_requests
      where business_id = p_business_id and status <> 'resolved')
  );
end;
$$;

revoke all on function public.change_checkout_date(uuid, date) from public, anon;
revoke all on function public.charge_order_to_room(uuid, text) from public, anon;
revoke all on function public.hotel_overview(uuid) from public, anon;
grant execute on function public.change_checkout_date(uuid, date) to authenticated;
grant execute on function public.charge_order_to_room(uuid, text) to authenticated;
grant execute on function public.hotel_overview(uuid) to authenticated;
