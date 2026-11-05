alter table public.business_settings
  add column if not exists public_description text
    check (public_description is null or char_length(public_description) <= 500),
  add column if not exists public_image_url text
    check (
      public_image_url is null
      or (
        char_length(public_image_url) <= 2048
        and public_image_url ~* '^https://[^[:space:]]+$'
      )
    );

alter table public.menu_items
  add column if not exists public_image_url text
    check (
      public_image_url is null
      or (
        char_length(public_image_url) <= 2048
        and public_image_url ~* '^https://[^[:space:]]+$'
      )
    );

create index if not exists businesses_public_name_prefix_idx
  on public.businesses (lower(name) text_pattern_ops)
  where status = 'active';

create or replace function public.search_public_businesses(
  p_query text default null,
  p_limit integer default 4
)
returns table (
  business_id uuid,
  name text,
  business_type text,
  location text,
  slug text,
  public_description text,
  public_image_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 4), 8));
begin
  if char_length(v_query) > 80 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  if v_query <> '' and char_length(v_query) < 2 then
    return;
  end if;

  return query
  select b.id, b.name, b.business_type::text, b.location, b.slug,
         s.public_description, s.public_image_url
    from public.businesses b
    join public.business_settings s on s.business_id = b.id
   where b.status = 'active'
     and s.public_ordering_enabled
     and (v_query = '' or lower(b.name) like v_query || '%')
     and exists (
       select 1
         from public.business_applications a
        where a.status = 'approved'
          and a.applicant_user_id = b.owner_user_id
          and a.business_name = b.name
          and a.business_type = b.business_type
          and a.location = b.location
     )
     and exists (
       select 1
         from public.menu_categories c
         join public.menu_items i
           on i.category_id = c.id and i.business_id = c.business_id
        where c.business_id = b.id
          and c.is_active
          and i.is_available
     )
   order by
     case when v_query = '' then b.created_at end desc,
     lower(b.name),
     b.id
   limit v_limit;
end;
$$;

create or replace function public.public_business_by_id(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business_id', b.id,
    'name', b.name,
    'business_type', b.business_type::text,
    'location', b.location,
    'slug', b.slug,
    'public_description', s.public_description,
    'public_image_url', s.public_image_url
  )
    from public.businesses b
    join public.business_settings s on s.business_id = b.id
   where b.id = p_business_id
     and b.status = 'active'
     and s.public_ordering_enabled
     and exists (
       select 1
         from public.business_applications a
        where a.status = 'approved'
          and a.applicant_user_id = b.owner_user_id
          and a.business_name = b.name
          and a.business_type = b.business_type
          and a.location = b.location
     )
     and exists (
       select 1
         from public.menu_categories c
         join public.menu_items i
           on i.category_id = c.id and i.business_id = c.business_id
        where c.business_id = b.id
          and c.is_active
          and i.is_available
     );
$$;

create or replace function public.public_menu(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business record;
begin
  select b.id, b.name, b.business_type::text as business_type, b.location,
         b.slug, s.currency_code, s.public_ordering_enabled,
         s.public_description, s.public_image_url
    into v_business
    from public.businesses b
    join public.business_settings s on s.business_id = b.id
    where b.slug = lower(btrim(p_slug)) and b.status = 'active';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'business_id', v_business.id,
    'name', v_business.name,
    'business_type', v_business.business_type,
    'location', v_business.location,
    'slug', v_business.slug,
    'currency_code', v_business.currency_code,
    'ordering_enabled', v_business.public_ordering_enabled,
    'public_description', v_business.public_description,
    'public_image_url', v_business.public_image_url,
    'tables', coalesce((
      select jsonb_agg(t.label order by t.label)
      from public.dining_tables t where t.business_id = v_business.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id, 'name', i.name, 'description', i.description,
            'price', i.price, 'image_url', i.public_image_url
          ) order by lower(i.name)), '[]'::jsonb)
          from public.menu_items i
          where i.category_id = c.id and i.business_id = c.business_id
            and i.is_available
        )) order by lower(c.name))
      from public.menu_categories c
      where c.business_id = v_business.id and c.is_active
        and exists (
          select 1 from public.menu_items i
          where i.category_id = c.id and i.business_id = c.business_id
            and i.is_available
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_menu_item_with_image(
  p_business_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_image_url text
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
  v_image_url text := nullif(btrim(p_image_url), '');
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
    or p_price::text in ('NaN', 'Infinity', '-Infinity')
    or (v_image_url is not null and
        (char_length(v_image_url) > 2048 or v_image_url !~* '^https://[^[:space:]]+$'))
  then
    raise exception 'Enter a valid item name, description, price, and HTTPS image URL'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.menu_categories c
    where c.id = p_category_id and c.business_id = p_business_id and c.is_active
  ) then
    raise exception 'Choose an active category belonging to this business'
      using errcode = '22023';
  end if;

  insert into public.menu_items (
    business_id, category_id, name, description, price, public_image_url, created_by
  ) values (
    p_business_id, p_category_id, v_name, v_description, p_price, v_image_url, auth.uid()
  ) returning id into v_item_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'menu.item_created', 'menu_item',
    v_item_id::text, jsonb_build_object('name', v_name, 'price', p_price,
      'image_set', v_image_url is not null)
  );
  return v_item_id;
end;
$$;

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
  if not public.has_business_permission(p_business_id, 'business.manage') then
    raise exception 'Business management permission required' using errcode = '42501';
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

revoke all on function public.search_public_businesses(text, integer)
  from public, authenticated;
revoke all on function public.public_business_by_id(uuid)
  from public, authenticated;
revoke all on function public.create_menu_item_with_image(uuid, uuid, text, text, numeric, text)
  from public, anon;
revoke all on function public.update_public_business_profile(uuid, text, text)
  from public, anon;
grant execute on function public.search_public_businesses(text, integer) to anon;
grant execute on function public.public_business_by_id(uuid) to anon;
grant execute on function public.create_menu_item_with_image(uuid, uuid, text, text, numeric, text)
  to authenticated;
grant execute on function public.update_public_business_profile(uuid, text, text)
  to authenticated;
