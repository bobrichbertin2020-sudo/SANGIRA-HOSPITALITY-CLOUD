insert into public.roles (role_key, label) values
  ('restaurant_manager', 'Restaurant manager')
on conflict (role_key) do nothing;

insert into public.permissions (permission_key, description) values
  ('restaurant.view', 'View the restaurant daily operations overview')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_key, permission_key) values
  ('restaurant_manager', 'business.view'),
  ('restaurant_manager', 'staff.view'),
  ('restaurant_manager', 'shifts.manage'),
  ('restaurant_manager', 'restaurant.view'),
  ('restaurant_manager', 'orders.view'),
  ('restaurant_manager', 'orders.manage'),
  ('restaurant_manager', 'menu.view')
on conflict (role_key, permission_key) do nothing;

create or replace function public.validate_restaurant_manager_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_inviter_id uuid;
  v_has_restaurant_manager boolean;
begin
  if tg_table_name = 'staff_invitations' then
    v_has_restaurant_manager :=
      'restaurant_manager' = any(coalesce(new.role_keys, array[]::text[]));
    v_business_id := new.business_id;
    v_inviter_id := new.invited_by;
  else
    v_has_restaurant_manager := new.role_key = 'restaurant_manager';
    select bm.business_id into v_business_id
    from public.business_memberships bm
    where bm.id = new.membership_id;
    v_inviter_id := new.assigned_by;
  end if;

  if not v_has_restaurant_manager then
    return new;
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = v_business_id
      and b.business_type = 'restaurant'
      and b.status = 'active'
  ) then
    raise exception 'Restaurant manager access can only be assigned to an active restaurant'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.business_memberships bm
    join public.membership_roles mr on mr.membership_id = bm.id
    where bm.business_id = v_business_id
      and bm.user_id = v_inviter_id
      and bm.status = 'active'
      and mr.role_key = 'business_owner'
  ) then
    raise exception 'Only an active business owner can assign restaurant manager access'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_restaurant_manager_assignment()
  from public, anon, authenticated;

create trigger restaurant_manager_invitation_guard
  before insert or update of role_keys, business_id, invited_by
  on public.staff_invitations
  for each row execute function public.validate_restaurant_manager_assignment();

create trigger restaurant_manager_membership_guard
  before insert or update of role_key, membership_id, assigned_by
  on public.membership_roles
  for each row execute function public.validate_restaurant_manager_assignment();

create or replace function public.restaurant_overview(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'restaurant.view') then
    raise exception 'Not allowed to view the restaurant overview'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.businesses
    where id = p_business_id
      and business_type = 'restaurant'
      and status = 'active'
  ) then
    raise exception 'Restaurant not found or unavailable' using errcode = 'P0002';
  end if;

  select coalesce((select s.timezone from public.business_settings s
                   where s.business_id = p_business_id), 'UTC') into v_tz;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;
  v_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_end := v_start + interval '1 day';

  return jsonb_build_object(
    'timezone', v_tz,
    'orders_today', (
      select count(*) from public.orders o
      where o.business_id = p_business_id
        and o.created_at >= v_start and o.created_at < v_end
        and o.status <> 'cancelled'
    ),
    'open_orders', (
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
    'staff_on_duty', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(pr.full_name, 'Staff member'),
        'since', a.clock_in_at
      ) order by a.clock_in_at), '[]'::jsonb)
      from public.attendance_records a
      left join public.profiles pr on pr.user_id = a.user_id
      where a.business_id = p_business_id and a.clock_out_at is null
    )
  );
end;
$$;

revoke all on function public.restaurant_overview(uuid) from public, anon;
grant execute on function public.restaurant_overview(uuid) to authenticated;
