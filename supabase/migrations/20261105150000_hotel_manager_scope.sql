insert into public.roles (role_key, label) values
  ('public_profile_manager', 'Public profile manager')
on conflict (role_key) do nothing;

insert into public.permissions (permission_key, description) values
  ('business.profile.manage', 'Update the public business description and image')
on conflict (permission_key) do nothing;

delete from public.role_permissions
where role_key = 'hotel_manager';

insert into public.role_permissions (role_key, permission_key) values
  ('hotel_manager', 'business.view'),
  ('hotel_manager', 'staff.view'),
  ('hotel_manager', 'shifts.manage'),
  ('hotel_manager', 'hotel.view'),
  ('hotel_manager', 'hotel.frontdesk'),
  ('hotel_manager', 'hotel.housekeeping'),
  ('hotel_manager', 'hotel.manage'),
  ('business_owner', 'business.profile.manage'),
  ('public_profile_manager', 'business.view'),
  ('public_profile_manager', 'business.profile.manage')
on conflict (role_key, permission_key) do nothing;

create or replace function public.update_public_business_profile(
  p_business_id uuid,
  p_description text,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := nullif(btrim(p_description), '');
  v_image_url text := nullif(btrim(p_image_url), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'business.profile.manage') then
    raise exception 'Public profile management permission required' using errcode = '42501';
  end if;
  if char_length(coalesce(v_description, '')) > 500 then
    raise exception 'Public description must be 500 characters or fewer'
      using errcode = '22023';
  end if;
  if v_image_url is not null
     and (char_length(v_image_url) > 2048 or v_image_url !~* '^https://[^[:space:]]+$') then
    raise exception 'Business image must use a valid HTTPS URL'
      using errcode = '22023';
  end if;

  update public.business_settings
     set public_description = v_description,
         public_image_url = v_image_url
   where business_id = p_business_id;
  if not found then
    raise exception 'Business settings not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'business.public_profile_updated', 'business',
    p_business_id::text,
    jsonb_build_object(
      'description_set', v_description is not null,
      'image_set', v_image_url is not null
    )
  );
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
    'folio_payments_today', case
      when public.has_business_permission(p_business_id, 'reports.view') then
        (select coalesce(sum(amount), 0) from public.folio_payments
          where business_id = p_business_id and created_at >= v_start)
      else null
    end,
    'open_maintenance', (select count(*) from public.maintenance_requests
      where business_id = p_business_id and status <> 'resolved')
  );
end;
$$;

revoke all on function public.update_public_business_profile(uuid, text, text)
  from public, anon;
grant execute on function public.update_public_business_profile(uuid, text, text)
  to authenticated;
revoke all on function public.hotel_overview(uuid) from public, anon;
grant execute on function public.hotel_overview(uuid) to authenticated;
