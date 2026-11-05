-- QR ordering. Customers are anonymous, so every customer-facing function below
-- is executable ONLY by the service role (the Next.js server). Browsers using the
-- public anon key cannot call them, which keeps rate limiting and session
-- checks authoritative. A customer session can only place and view orders for
-- one business and one table; it grants no staff or management access.

alter table public.business_settings
  add column if not exists public_ordering_enabled boolean not null default true;

alter table public.orders alter column created_by drop not null;

alter table public.orders
  add column if not exists source text not null default 'staff',
  add column if not exists table_session_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_source_check'
  ) then
    alter table public.orders
      add constraint orders_source_check check (
        (source = 'staff' and created_by is not null)
        or (source = 'qr' and table_session_id is not null)
      );
  end if;
end;
$$;

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  label text not null check (label ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,19}$'),
  created_at timestamptz not null default now()
);

create unique index dining_tables_business_label_idx
  on public.dining_tables (business_id, lower(label));

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  table_label text not null check (char_length(table_label) between 1 and 20),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  client_hash text not null check (char_length(client_hash) between 8 and 128),
  order_count integer not null default 0 check (order_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index table_sessions_business_idx
  on public.table_sessions (business_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_table_session_fkey'
  ) then
    alter table public.orders
      add constraint orders_table_session_fkey
      foreign key (table_session_id) references public.table_sessions (id)
      on delete restrict;
  end if;
end;
$$;

create table public.public_rate_events (
  id bigint generated always as identity primary key,
  scope text not null,
  key text not null,
  created_at timestamptz not null default now()
);

create index public_rate_events_lookup_idx
  on public.public_rate_events (scope, key, created_at desc);
create index public_rate_events_created_idx
  on public.public_rate_events (created_at);

alter table public.dining_tables enable row level security;
alter table public.table_sessions enable row level security;
alter table public.public_rate_events enable row level security;

drop policy if exists "Staff read dining tables" on public.dining_tables;
create policy "Staff read dining tables"
  on public.dining_tables for select to authenticated
  using ((select public.has_business_permission(business_id, 'business.view')));

drop policy if exists "Order staff read table sessions" on public.table_sessions;
create policy "Order staff read table sessions"
  on public.table_sessions for select to authenticated
  using ((select public.has_business_permission(business_id, 'orders.view')));

revoke all on public.dining_tables, public.table_sessions, public.public_rate_events
  from anon, authenticated;
grant select on public.dining_tables, public.table_sessions to authenticated;

create or replace function public.qr_check_rate(
  p_scope text,
  p_key text,
  p_limit integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_key, 0));

  delete from public.public_rate_events
    where created_at < now() - interval '1 day'
      and id in (
        select id from public.public_rate_events
        where created_at < now() - interval '1 day' limit 200
      );

  select count(*) into v_count
    from public.public_rate_events
    where scope = p_scope and key = p_key
      and created_at > now() - p_window;

  if v_count >= p_limit then
    raise exception 'Too many requests. Please wait a few minutes and try again.'
      using errcode = 'P0429';
  end if;

  insert into public.public_rate_events (scope, key) values (p_scope, p_key);
end;
$$;

create or replace function public.qr_verify_session(
  p_session_id uuid,
  p_nonce_hash text
)
returns public.table_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;

  if not found
    or v_session.nonce_hash is distinct from p_nonce_hash
    or v_session.revoked_at is not null
    or v_session.expires_at <= now()
  then
    raise exception 'Your ordering session has expired. Please scan the QR code again.'
      using errcode = 'P0401';
  end if;

  if not exists (
    select 1
    from public.businesses b
    join public.business_settings s on s.business_id = b.id
    where b.id = v_session.business_id
      and b.status = 'active'
      and s.public_ordering_enabled
  ) then
    raise exception 'Online ordering is not available for this business.'
      using errcode = 'P0403';
  end if;

  return v_session;
end;
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
         s.currency_code, s.public_ordering_enabled
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
    'currency_code', v_business.currency_code,
    'ordering_enabled', v_business.public_ordering_enabled,
    'tables', coalesce((
      select jsonb_agg(t.label order by t.label)
      from public.dining_tables t where t.business_id = v_business.id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', mi.id, 'name', mi.name, 'description', mi.description,
            'price', mi.price) order by lower(mi.name)), '[]'::jsonb)
          from public.menu_items mi
          where mi.category_id = c.id and mi.business_id = c.business_id
            and mi.is_available
        )) order by lower(c.name))
      from public.menu_categories c
      where c.business_id = v_business.id and c.is_active
        and exists (
          select 1 from public.menu_items mi
          where mi.category_id = c.id and mi.business_id = c.business_id
            and mi.is_available
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.start_table_session(
  p_slug text,
  p_table_label text,
  p_nonce_hash text,
  p_client_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_table text := btrim(p_table_label);
  v_has_tables boolean;
  v_session_id uuid;
  v_expires timestamptz := now() + interval '3 hours';
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_client_hash is null or char_length(p_client_hash) not between 8 and 128
  then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  select b.id into v_business_id
    from public.businesses b
    join public.business_settings s on s.business_id = b.id
    where b.slug = lower(btrim(p_slug)) and b.status = 'active'
      and s.public_ordering_enabled;

  if v_business_id is null then
    raise exception 'Online ordering is not available for this business.'
      using errcode = 'P0403';
  end if;

  if v_table is null or v_table !~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,19}$' then
    raise exception 'Enter a valid table number (letters, digits, spaces, - . _; up to 20 characters).'
      using errcode = '22023';
  end if;

  select exists (select 1 from public.dining_tables where business_id = v_business_id)
    into v_has_tables;

  if v_has_tables and not exists (
    select 1 from public.dining_tables
    where business_id = v_business_id and lower(label) = lower(v_table)
  ) then
    raise exception 'Choose one of this venue''s table numbers.'
      using errcode = '22023';
  end if;

  perform public.qr_check_rate('session_client', p_client_hash, 10, interval '10 minutes');
  perform public.qr_check_rate('session_business', v_business_id::text, 300, interval '1 hour');

  insert into public.table_sessions (
    business_id, table_label, nonce_hash, client_hash, expires_at
  ) values (
    v_business_id, v_table, p_nonce_hash, p_client_hash, v_expires
  ) returning id into v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'business_id', v_business_id,
    'table_label', v_table,
    'expires_at', v_expires
  );
end;
$$;

create or replace function public.place_customer_order(
  p_session_id uuid,
  p_nonce_hash text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_notes text := nullif(btrim(p_notes), '');
  v_count integer;
  v_distinct integer;
  v_valid boolean;
  v_routable integer;
  v_total numeric(14, 2);
  v_quantity integer;
  v_order_id uuid;
  v_order_code text;
begin
  v_session := public.qr_verify_session(p_session_id, p_nonce_hash);

  if char_length(coalesce(v_notes, '')) > 300 then
    raise exception 'Notes can be up to 300 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 30
  then
    raise exception 'Choose between 1 and 30 menu items' using errcode = '22023';
  end if;
  if v_session.order_count >= 20 then
    raise exception 'This session has reached its order limit. Please ask staff for help.'
      using errcode = 'P0429';
  end if;

  perform public.qr_check_rate('order_session', v_session.id::text, 5, interval '10 minutes');
  perform public.qr_check_rate('order_table', v_session.business_id::text || ':' || lower(v_session.table_label), 15, interval '1 hour');

  select count(*),
         count(distinct r.menu_item_id),
         coalesce(bool_and(r.menu_item_id is not null
           and r.quantity between 1 and 20), false),
         count(*) filter (where mi.id is not null and d.id is not null),
         coalesce(sum(mi.price * r.quantity), 0),
         coalesce(sum(r.quantity), 0)
    into v_count, v_distinct, v_valid, v_routable, v_total, v_quantity
    from jsonb_to_recordset(p_items) as r(menu_item_id uuid, quantity integer)
    left join public.menu_items mi
      on mi.id = r.menu_item_id
      and mi.business_id = v_session.business_id
      and mi.is_available
    left join public.departments d
      on d.business_id = v_session.business_id
      and d.department_key = mi.department_key
      and d.is_enabled;

  if v_count <> jsonb_array_length(p_items) or v_distinct <> v_count
    or not v_valid or v_routable <> v_count or v_quantity > 100
  then
    raise exception 'Choose unique available menu items (quantity 1 to 20 each, 100 in total)'
      using errcode = '22023';
  end if;

  insert into public.orders (
    business_id, table_label, notes, total_amount, source, table_session_id
  ) values (
    v_session.business_id, v_session.table_label, v_notes, v_total, 'qr',
    v_session.id
  ) returning id, order_code into v_order_id, v_order_code;

  insert into public.order_items (
    business_id, order_id, order_code, table_label, menu_item_id,
    item_name, unit_price, quantity, department_key
  )
  select v_session.business_id, v_order_id, v_order_code, v_session.table_label,
    mi.id, mi.name, mi.price, r.quantity, mi.department_key
  from jsonb_to_recordset(p_items) as r(menu_item_id uuid, quantity integer)
  join public.menu_items mi
    on mi.id = r.menu_item_id and mi.business_id = v_session.business_id;

  update public.table_sessions
    set order_count = order_count + 1
    where id = v_session.id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_session.business_id, null, 'order.placed_qr', 'order', v_order_id::text,
    jsonb_build_object('order_code', v_order_code, 'table', v_session.table_label,
      'item_count', v_count, 'total_amount', v_total)
  );

  return jsonb_build_object(
    'order_id', v_order_id, 'order_code', v_order_code, 'total_amount', v_total
  );
end;
$$;

create or replace function public.customer_session_orders(
  p_session_id uuid,
  p_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  v_session := public.qr_verify_session(p_session_id, p_nonce_hash);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_code', o.order_code,
      'status', o.status::text,
      'created_at', o.created_at,
      'items', (
        select jsonb_agg(jsonb_build_object(
          'name', i.item_name, 'quantity', i.quantity,
          'unit_price', i.unit_price, 'status', i.status::text)
          order by i.created_at, i.item_name)
        from public.order_items i where i.order_id = o.id
      )) order by o.created_at desc)
    from public.orders o
    where o.table_session_id = v_session.id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_public_ordering(
  p_business_id uuid,
  p_enabled boolean
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
  if not public.has_business_permission(p_business_id, 'business.manage') then
    raise exception 'Business management permission required' using errcode = '42501';
  end if;

  update public.business_settings
    set public_ordering_enabled = coalesce(p_enabled, true)
    where business_id = p_business_id;

  if not found then
    raise exception 'Business settings not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'business.public_ordering', 'business',
    p_business_id::text, jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

create or replace function public.set_dining_tables(
  p_business_id uuid,
  p_labels text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_labels text[];
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'business.manage') then
    raise exception 'Business management permission required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct btrim(l)), '{}')
    into v_labels
    from unnest(coalesce(p_labels, '{}')) as l
    where btrim(l) <> '';

  if cardinality(v_labels) > 200
    or exists (
      select 1 from unnest(v_labels) l
      where l !~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,19}$'
    )
  then
    raise exception 'Use up to 200 table labels of letters, digits, spaces, - . _ (max 20 characters)'
      using errcode = '22023';
  end if;

  select count(*) into v_count
    from (select distinct lower(l) from unnest(v_labels) l) d;
  if v_count <> cardinality(v_labels) then
    raise exception 'Table labels must be unique ignoring case' using errcode = '22023';
  end if;

  delete from public.dining_tables
    where business_id = p_business_id
      and lower(label) not in (select lower(l) from unnest(v_labels) l);

  insert into public.dining_tables (business_id, label)
  select p_business_id, l from unnest(v_labels) l
  on conflict (business_id, lower(label)) do nothing;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'business.dining_tables', 'business',
    p_business_id::text, jsonb_build_object('count', cardinality(v_labels))
  );

  return cardinality(v_labels);
end;
$$;

revoke all on function public.qr_check_rate(text, text, integer, interval)
  from public, anon, authenticated;
revoke all on function public.qr_verify_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.public_menu(text)
  from public, anon, authenticated;
revoke all on function public.start_table_session(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.place_customer_order(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.customer_session_orders(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_public_ordering(uuid, boolean) from public, anon;
revoke all on function public.set_dining_tables(uuid, text[]) from public, anon;

grant execute on function public.public_menu(text) to service_role;
grant execute on function public.start_table_session(text, text, text, text) to service_role;
grant execute on function public.place_customer_order(uuid, text, text, jsonb) to service_role;
grant execute on function public.customer_session_orders(uuid, text) to service_role;
grant execute on function public.set_public_ordering(uuid, boolean) to authenticated;
grant execute on function public.set_dining_tables(uuid, text[]) to authenticated;
