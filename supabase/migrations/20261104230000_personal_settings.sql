-- Personal settings: extends public.profiles (no new user table) and adds an avatar bucket,
-- account deletion requests, and self-service RPCs. Roles, memberships and approvals are untouched.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists username text,
  add column if not exists address text,
  add column if not exists language text not null default 'en',
  add column if not exists theme text not null default 'system',
  add column if not exists avatar_path text,
  add column if not exists email_order_updates boolean not null default true,
  add column if not exists email_stock_alerts boolean not null default true,
  add column if not exists email_payment_alerts boolean not null default true,
  add column if not exists inapp_order_updates boolean not null default true,
  add column if not exists inapp_stock_alerts boolean not null default true,
  add column if not exists inapp_payment_alerts boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_name_length_check') then
    alter table public.profiles add constraint profiles_name_length_check check (
      (first_name is null or char_length(first_name) between 1 and 80)
      and (last_name is null or char_length(last_name) between 1 and 80)
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_username_format_check') then
    alter table public.profiles add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-z0-9_.]{3,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_address_length_check') then
    alter table public.profiles add constraint profiles_address_length_check
      check (address is null or char_length(address) <= 240);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_language_check') then
    alter table public.profiles add constraint profiles_language_check
      check (language in ('en', 'sw', 'fr', 'rw'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_theme_check') then
    alter table public.profiles add constraint profiles_theme_check
      check (theme in ('light', 'dark', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_avatar_owner_check') then
    alter table public.profiles add constraint profiles_avatar_owner_check
      check (avatar_path is null or avatar_path like user_id::text || '/%');
  end if;
  -- NOT VALID so existing rows are never rejected; new and changed rows are checked.
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_phone_format_check') then
    alter table public.profiles add constraint profiles_phone_format_check
      check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$') not valid;
  end if;
end;
$$;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username)) where username is not null;

-- Personal fields such as address and notification choices are not visible to other staff:
-- other users can still read only the columns the app already used.
revoke select on public.profiles from authenticated;
grant select (user_id, full_name, phone, created_at, updated_at)
  on public.profiles to authenticated;

create or replace function public.get_my_profile()
returns table (
  user_id uuid, first_name text, last_name text, full_name text, username text,
  phone text, address text, language text, theme text, avatar_path text,
  email_order_updates boolean, email_stock_alerts boolean, email_payment_alerts boolean,
  inapp_order_updates boolean, inapp_stock_alerts boolean, inapp_payment_alerts boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.first_name, p.last_name, p.full_name, p.username, p.phone,
         p.address, p.language, p.theme, p.avatar_path,
         p.email_order_updates, p.email_stock_alerts, p.email_payment_alerts,
         p.inapp_order_updates, p.inapp_stock_alerts, p.inapp_payment_alerts
  from public.profiles p
  where p.user_id = auth.uid();
$$;

create or replace function public.update_my_profile(
  p_first_name text,
  p_last_name text,
  p_username text,
  p_phone text,
  p_address text,
  p_language text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := nullif(btrim(p_first_name), '');
  v_last text := nullif(btrim(p_last_name), '');
  v_username text := nullif(lower(btrim(p_username)), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_address text := nullif(btrim(p_address), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_first is null or v_last is null
    or char_length(v_first) > 80 or char_length(v_last) > 80
    or (v_username is not null and v_username !~ '^[a-z0-9_.]{3,30}$')
    or (v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{7,20}$')
    or char_length(coalesce(v_address, '')) > 240
    or p_language not in ('en', 'sw', 'fr', 'rw')
  then
    raise exception 'Invalid profile details' using errcode = '22023';
  end if;

  update public.profiles
    set first_name = v_first,
        last_name = v_last,
        full_name = v_first || ' ' || v_last,
        username = v_username,
        phone = v_phone,
        address = v_address,
        language = p_language
    where user_id = auth.uid();
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Null arguments leave that preference unchanged, so appearance and notifications save separately.
create or replace function public.update_my_preferences(
  p_theme text default null,
  p_language text default null,
  p_email_order_updates boolean default null,
  p_email_stock_alerts boolean default null,
  p_email_payment_alerts boolean default null,
  p_inapp_order_updates boolean default null,
  p_inapp_stock_alerts boolean default null,
  p_inapp_payment_alerts boolean default null
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
  if (p_theme is not null and p_theme not in ('light', 'dark', 'system'))
    or (p_language is not null and p_language not in ('en', 'sw', 'fr', 'rw'))
  then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;

  update public.profiles
    set theme = coalesce(p_theme, theme),
        language = coalesce(p_language, language),
        email_order_updates = coalesce(p_email_order_updates, email_order_updates),
        email_stock_alerts = coalesce(p_email_stock_alerts, email_stock_alerts),
        email_payment_alerts = coalesce(p_email_payment_alerts, email_payment_alerts),
        inapp_order_updates = coalesce(p_inapp_order_updates, inapp_order_updates),
        inapp_stock_alerts = coalesce(p_inapp_stock_alerts, inapp_stock_alerts),
        inapp_payment_alerts = coalesce(p_inapp_payment_alerts, inapp_payment_alerts)
    where user_id = auth.uid();
end;
$$;
-- Returns the previous path so the caller can delete the replaced file.
create or replace function public.set_my_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_path is not null and (
    p_path not like auth.uid()::text || '/%' or char_length(p_path) > 200
  ) then
    raise exception 'Invalid avatar path' using errcode = '22023';
  end if;

  select avatar_path into v_old from public.profiles where user_id = auth.uid();
  update public.profiles set avatar_path = p_path where user_id = auth.uid();
  return v_old;
end;
$$;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists account_deletion_one_pending_idx
  on public.account_deletion_requests (user_id) where status = 'pending';

alter table public.account_deletion_requests enable row level security;

drop policy if exists "Users read their own deletion requests" on public.account_deletion_requests;
create policy "Users read their own deletion requests"
  on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

-- Only records a request for administrators to review. Business records (orders, payments,
-- stock movements) keep referencing the user, so nothing is deleted here.
create or replace function public.request_account_deletion(p_confirm text, p_reason text default null)
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
  if p_confirm is distinct from 'DELETE' then
    raise exception 'Confirmation text is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.businesses
    where owner_user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Transfer business ownership before requesting deletion'
      using errcode = 'P0001';
  end if;

  select id into v_id from public.account_deletion_requests
    where user_id = auth.uid() and status = 'pending';
  if found then
    return v_id;
  end if;

  insert into public.account_deletion_requests (user_id, reason)
    values (auth.uid(), left(nullif(btrim(p_reason), ''), 500))
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cancel_account_deletion()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.account_deletion_requests
    set status = 'cancelled', resolved_at = now()
    where user_id = auth.uid() and status = 'pending';
$$;

revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.update_my_profile(text, text, text, text, text, text) from public, anon;
revoke all on function public.update_my_preferences(
  text, text, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.set_my_avatar(text) from public, anon;
revoke all on function public.request_account_deletion(text, text) from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(text, text, text, text, text, text) to authenticated;
grant execute on function public.update_my_preferences(
  text, text, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.request_account_deletion(text, text) to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;

-- Private avatar bucket: each user owns only the folder named after their user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sangira-avatars', 'sangira-avatars', false, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Users upload their own avatar" on storage.objects;
create policy "Users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sangira-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users read their own avatar" on storage.objects;
create policy "Users read their own avatar"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sangira-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their own avatar" on storage.objects;
create policy "Users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sangira-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
