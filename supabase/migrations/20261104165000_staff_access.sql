create table public.membership_departments (
  membership_id uuid not null references public.business_memberships (id) on delete restrict,
  department_id uuid not null references public.departments (id) on delete restrict,
  assigned_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (membership_id, department_id)
);

create index membership_departments_department_idx
  on public.membership_departments (department_id, membership_id);

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
    join public.membership_roles mr on mr.membership_id = bm.id
    join public.role_permissions rp on rp.role_key = mr.role_key
    join public.membership_departments md on md.membership_id = bm.id
    join public.departments d on d.id = md.department_id
    where bm.business_id = p_business_id
      and bm.user_id = (select auth.uid())
      and bm.status = 'active'
      and d.id = p_department_id
      and d.business_id = p_business_id
      and d.is_enabled
      and rp.permission_key = p_permission_key
  );
$$;

revoke all on function public.has_department_permission(uuid, uuid, text)
  from public, anon;
grant execute on function public.has_department_permission(uuid, uuid, text)
  to authenticated;

create or replace function public.assign_owner_department_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'membership_roles' then
    if new.role_key = 'business_owner' then
      insert into public.membership_departments (
        membership_id,
        department_id,
        assigned_by
      )
      select new.membership_id, d.id, new.assigned_by
      from public.business_memberships bm
      join public.departments d on d.business_id = bm.business_id
      where bm.id = new.membership_id
      on conflict (membership_id, department_id) do nothing;
    end if;
  else
    insert into public.membership_departments (
      membership_id,
      department_id,
      assigned_by
    )
    select mr.membership_id, new.id, mr.assigned_by
    from public.membership_roles mr
    join public.business_memberships bm on bm.id = mr.membership_id
    where bm.business_id = new.business_id
      and mr.role_key = 'business_owner'
    on conflict (membership_id, department_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.assign_owner_department_access()
  from public, anon, authenticated;

create trigger assign_owner_department_on_role
  after insert on public.membership_roles
  for each row execute function public.assign_owner_department_access();

create trigger assign_owner_department_on_department
  after insert on public.departments
  for each row execute function public.assign_owner_department_access();

create type public.staff_invitation_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  email text not null check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role_keys text[] not null check (cardinality(role_keys) between 1 and 9),
  department_ids uuid[] not null check (cardinality(department_ids) between 1 and 6),
  status public.staff_invitation_status not null default 'pending',
  invited_by uuid not null references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_invitation_acceptance_state check (
    (status = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_by is null and accepted_at is null)
  ),
  constraint staff_invitation_expiry check (expires_at > created_at)
);

create unique index staff_invitations_one_pending_email
  on public.staff_invitations (business_id, email)
  where status = 'pending';

create index staff_invitations_business_created_idx
  on public.staff_invitations (business_id, created_at desc);

create or replace function public.create_staff_invitation(
  p_business_id uuid,
  p_email text,
  p_role_keys text[],
  p_department_ids uuid[],
  p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation_id uuid;
  v_email text := lower(btrim(p_email));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_business_permission(p_business_id, 'staff.manage') then
    raise exception 'Staff management permission required' using errcode = '42501';
  end if;

  if v_email is null
    or char_length(v_email) not between 3 and 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'A valid invitation email is required' using errcode = '22023';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token' using errcode = '22023';
  end if;

  if 'hotel_manager' = any(coalesce(p_role_keys, array[]::text[]))
    and not exists (
      select 1
      from public.business_memberships bm
      join public.membership_roles mr on mr.membership_id = bm.id
      where bm.business_id = p_business_id
        and bm.user_id = auth.uid()
        and bm.status = 'active'
        and mr.role_key = 'business_owner'
    )
  then
    raise exception 'Only a business owner can delegate hotel manager access'
      using errcode = '42501';
  end if;

  update public.staff_invitations
    set status = 'expired'
    where business_id = p_business_id
      and email = v_email
      and status = 'pending'
      and expires_at <= now();

  if coalesce(cardinality(p_role_keys), 0) not between 1 and 9
    or exists (
      select 1
      from unnest(p_role_keys) as requested(role_key)
      left join public.roles r on r.role_key = requested.role_key
      where r.role_key is null or requested.role_key = 'business_owner'
    )
    or (select count(distinct role_key) from unnest(p_role_keys) as requested(role_key))
      <> cardinality(p_role_keys)
  then
    raise exception 'Choose valid roles; business owner access cannot be delegated by invitation'
      using errcode = '22023';
  end if;

  if coalesce(cardinality(p_department_ids), 0) not between 1 and 6
    or exists (
      select 1
      from unnest(p_department_ids) as requested(department_id)
      left join public.departments d
        on d.id = requested.department_id
        and d.business_id = p_business_id
        and d.is_enabled
      where d.id is null
    )
    or (select count(distinct department_id)
        from unnest(p_department_ids) as requested(department_id))
      <> cardinality(p_department_ids)
  then
    raise exception 'Choose enabled departments belonging to this business'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from auth.users u
    join public.business_memberships bm on bm.user_id = u.id
    where bm.business_id = p_business_id
      and bm.status in ('active', 'invited')
      and lower(u.email) = v_email
  ) then
    raise exception 'This person already has a membership in the business'
      using errcode = '23505';
  end if;

  insert into public.staff_invitations (
    business_id,
    email,
    token_hash,
    role_keys,
    department_ids,
    invited_by,
    expires_at
  )
  values (
    p_business_id,
    v_email,
    p_token_hash,
    p_role_keys,
    p_department_ids,
    auth.uid(),
    now() + interval '7 days'
  )
  returning id into v_invitation_id;

  insert into public.audit_logs (
    business_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    p_business_id,
    auth.uid(),
    'staff_invitation.created',
    'staff_invitation',
    v_invitation_id::text,
    jsonb_build_object('email', v_email, 'role_keys', p_role_keys)
  );

  return v_invitation_id;
end;
$$;

create or replace function public.accept_staff_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.staff_invitations%rowtype;
  v_user_email text;
  v_membership_id uuid;
  v_role_key text;
  v_department_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in with the invited account to accept this invitation'
      using errcode = '28000';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation is invalid or has expired' using errcode = '22023';
  end if;

  select lower(u.email)
    into v_user_email
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null;

  if v_user_email is null then
    raise exception 'Verify your email address before accepting an invitation'
      using errcode = '42501';
  end if;

  select *
    into v_invitation
    from public.staff_invitations
    where token_hash = p_token_hash
    for update;

  if not found or v_invitation.status <> 'pending'
    or v_invitation.expires_at <= now()
  then
    raise exception 'Invitation is invalid, expired, or already used'
      using errcode = '22023';
  end if;

  if v_invitation.email <> v_user_email then
    raise exception 'Sign in with the email address this invitation was sent to'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.businesses b
    where b.id = v_invitation.business_id and b.status = 'active'
  ) then
    raise exception 'This business workspace is not active' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.business_memberships bm
    where bm.business_id = v_invitation.business_id
      and bm.user_id = auth.uid()
  ) then
    raise exception 'You already have a membership in this business'
      using errcode = '23505';
  end if;

  insert into public.business_memberships (business_id, user_id, status, invited_by)
  values (v_invitation.business_id, auth.uid(), 'active', v_invitation.invited_by)
  returning id into v_membership_id;

  foreach v_role_key in array v_invitation.role_keys
  loop
    insert into public.membership_roles (membership_id, role_key, assigned_by)
    values (v_membership_id, v_role_key, v_invitation.invited_by);
  end loop;

  foreach v_department_id in array v_invitation.department_ids
  loop
    insert into public.membership_departments (
      membership_id,
      department_id,
      assigned_by
    )
    values (v_membership_id, v_department_id, v_invitation.invited_by);
  end loop;

  update public.staff_invitations
    set status = 'accepted',
        accepted_by = auth.uid(),
        accepted_at = now()
    where id = v_invitation.id;

  insert into public.audit_logs (
    business_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    v_invitation.business_id,
    auth.uid(),
    'staff_invitation.accepted',
    'staff_invitation',
    v_invitation.id::text,
    jsonb_build_object('membership_id', v_membership_id)
  );

  return v_invitation.business_id;
end;
$$;

create or replace function public.revoke_staff_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.staff_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select *
    into v_invitation
    from public.staff_invitations
    where id = p_invitation_id
    for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if not public.has_business_permission(v_invitation.business_id, 'staff.manage') then
    raise exception 'Staff management permission required' using errcode = '42501';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked' using errcode = '22023';
  end if;

  if v_invitation.expires_at <= now() then
    update public.staff_invitations
      set status = 'expired'
      where id = v_invitation.id;

    insert into public.audit_logs (
      business_id,
      actor_user_id,
      action,
      entity_type,
      entity_id
    )
    values (
      v_invitation.business_id,
      auth.uid(),
      'staff_invitation.expired',
      'staff_invitation',
      v_invitation.id::text
    );

    return;
  end if;

  update public.staff_invitations
    set status = 'revoked'
    where id = v_invitation.id;

  insert into public.audit_logs (
    business_id,
    actor_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    v_invitation.business_id,
    auth.uid(),
    'staff_invitation.revoked',
    'staff_invitation',
    v_invitation.id::text
  );
end;
$$;

revoke all on function public.create_staff_invitation(
  uuid, text, text[], uuid[], text
) from public, anon;
revoke all on function public.accept_staff_invitation(text) from public, anon;
revoke all on function public.revoke_staff_invitation(uuid) from public, anon;
grant execute on function public.create_staff_invitation(
  uuid, text, text[], uuid[], text
) to authenticated;
grant execute on function public.accept_staff_invitation(text) to authenticated;
grant execute on function public.revoke_staff_invitation(uuid) to authenticated;

insert into public.membership_departments (
  membership_id,
  department_id,
  assigned_by
)
select bm.id, d.id, b.created_by
from public.business_memberships bm
join public.businesses b on b.id = bm.business_id
join public.departments d on d.business_id = bm.business_id
join public.membership_roles mr
  on mr.membership_id = bm.id
  and mr.role_key = 'business_owner'
where bm.status = 'active';

alter table public.membership_departments enable row level security;
alter table public.staff_invitations enable row level security;

create policy "Members read their authorized department assignments"
  on public.membership_departments for select to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      join public.departments d on d.id = department_id
      where bm.id = membership_id
        and (
          bm.user_id = (select auth.uid())
          or (select public.is_platform_admin())
          or (select public.has_business_permission(d.business_id, 'staff.view'))
        )
    )
  );

create policy "Staff managers read business invitations"
  on public.staff_invitations for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'staff.manage'))
  );

drop policy "Users read their own profile" on public.profiles;

create policy "Users and authorized staff read profiles"
  on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.business_memberships bm
      where bm.user_id = profiles.user_id
        and bm.status = 'active'
        and (select public.has_business_permission(bm.business_id, 'staff.view'))
    )
  );

revoke all on public.membership_departments, public.staff_invitations
  from anon, authenticated;

grant select on public.membership_departments to authenticated;
grant select (
  id,
  business_id,
  email,
  role_keys,
  department_ids,
  status,
  invited_by,
  expires_at,
  accepted_by,
  accepted_at,
  created_at
) on public.staff_invitations to authenticated;
