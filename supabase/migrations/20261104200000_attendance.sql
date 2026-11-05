-- Staff attendance. Any active member clocks themself in and out; staff with
-- shifts.manage can read every record in their business. Writes go only
-- through the functions below.

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attendance_clock_order check (
    clock_out_at is null or clock_out_at >= clock_in_at
  )
);

create unique index attendance_one_open_per_user
  on public.attendance_records (business_id, user_id)
  where clock_out_at is null;

create index attendance_business_time_idx
  on public.attendance_records (business_id, clock_in_at desc);

create index attendance_user_time_idx
  on public.attendance_records (user_id, clock_in_at desc);

create or replace function public.is_active_business_member(p_business_id uuid)
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
    where bm.business_id = p_business_id
      and bm.user_id = (select auth.uid())
      and bm.status = 'active'
      and b.status = 'active'
  );
$$;

create or replace function public.clock_in(p_business_id uuid)
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

  if not public.is_active_business_member(p_business_id) then
    raise exception 'Not an active member of this business' using errcode = '42501';
  end if;

  begin
    insert into public.attendance_records (business_id, user_id)
    values (p_business_id, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You are already clocked in' using errcode = '23505';
  end;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'attendance.clock_in', 'attendance',
    v_id::text, '{}'::jsonb
  );

  return v_id;
end;
$$;

create or replace function public.clock_out(p_business_id uuid)
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

  if not public.is_active_business_member(p_business_id) then
    raise exception 'Not an active member of this business' using errcode = '42501';
  end if;

  update public.attendance_records
    set clock_out_at = now()
    where business_id = p_business_id
      and user_id = auth.uid()
      and clock_out_at is null
    returning id into v_id;

  if v_id is null then
    raise exception 'You are not clocked in' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'attendance.clock_out', 'attendance',
    v_id::text, '{}'::jsonb
  );

  return v_id;
end;
$$;

alter table public.attendance_records enable row level security;

drop policy if exists "Staff read own and managed attendance" on public.attendance_records;
create policy "Staff read own and managed attendance"
  on public.attendance_records for select to authenticated
  using (
    (user_id = (select auth.uid())
      and (select public.is_active_business_member(business_id)))
    or (select public.has_business_permission(business_id, 'shifts.manage'))
  );

revoke all on public.attendance_records from anon, authenticated;
grant select on public.attendance_records to authenticated;

revoke all on function public.is_active_business_member(uuid) from public, anon;
revoke all on function public.clock_in(uuid) from public, anon;
revoke all on function public.clock_out(uuid) from public, anon;
grant execute on function public.is_active_business_member(uuid) to authenticated;
grant execute on function public.clock_in(uuid) to authenticated;
grant execute on function public.clock_out(uuid) to authenticated;
