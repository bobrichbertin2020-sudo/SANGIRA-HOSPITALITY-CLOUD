-- Purchasing: purchase orders with approval, and receiving against them.
-- Stock managers raise orders, an owner or hotel manager approves, and the
-- stock manager records what was actually delivered (partial deliveries are
-- allowed). Receiving reuses receive_stock so batches, balances, the movement
-- ledger and the audit log stay in one place.

insert into public.permissions (permission_key, description) values
  ('purchasing.approve', 'Approve or reject purchase orders')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_key, permission_key) values
  ('business_owner', 'purchasing.approve'),
  ('hotel_manager', 'purchasing.approve')
on conflict (role_key, permission_key) do nothing;

create type public.purchase_order_status as enum (
  'pending_approval', 'approved', 'rejected', 'partially_received',
  'received', 'cancelled'
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  po_number text not null,
  supplier_id uuid,
  status public.purchase_order_status not null default 'pending_approval',
  notes text check (notes is null or char_length(notes) <= 500),
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 300),
  created_by uuid not null references auth.users (id) on delete restrict,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, po_number),
  foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id) on delete restrict
);

create index purchase_orders_business_idx
  on public.purchase_orders (business_id, created_at desc);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  purchase_order_id uuid not null,
  stock_item_id uuid not null,
  quantity_ordered numeric(14, 3) not null check (quantity_ordered > 0),
  estimated_unit_cost numeric(14, 2) not null default 0 check (estimated_unit_cost >= 0),
  quantity_received numeric(14, 3) not null default 0 check (quantity_received >= 0),
  unique (purchase_order_id, stock_item_id),
  unique (id, business_id),
  foreign key (purchase_order_id, business_id)
    references public.purchase_orders (id, business_id) on delete restrict,
  foreign key (stock_item_id, business_id)
    references public.stock_items (id, business_id) on delete restrict,
  check (quantity_received <= quantity_ordered)
);

create index purchase_order_items_po_idx
  on public.purchase_order_items (purchase_order_id);

create table public.purchase_order_receipts (
  receipt_id uuid primary key references public.stock_receipts (id) on delete restrict,
  business_id uuid not null,
  purchase_order_item_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  foreign key (purchase_order_item_id, business_id)
    references public.purchase_order_items (id, business_id) on delete restrict
);

drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_order_receipts enable row level security;

create policy "Purchasing staff read purchase orders"
  on public.purchase_orders for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'inventory.manage'))
    or (select public.has_business_permission(business_id, 'purchasing.approve'))
  );

create policy "Purchasing staff read purchase order items"
  on public.purchase_order_items for select to authenticated
  using (
    (select public.has_business_permission(business_id, 'inventory.manage'))
    or (select public.has_business_permission(business_id, 'purchasing.approve'))
  );

revoke all on public.purchase_orders, public.purchase_order_items,
  public.purchase_order_receipts from anon, authenticated;
grant select on public.purchase_orders, public.purchase_order_items to authenticated;

create or replace function public.create_purchase_order(
  p_business_id uuid,
  p_supplier_id uuid,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_number text;
  v_notes text := nullif(btrim(p_notes), '');
  v_count integer;
  v_valid integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_business_permission(p_business_id, 'inventory.manage') then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;
  if char_length(coalesce(v_notes, '')) > 500
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 50
  then
    raise exception 'Add between 1 and 50 items to the purchase order'
      using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s
    where s.id = p_supplier_id and s.business_id = p_business_id and s.is_active
  ) then
    raise exception 'Choose an active supplier' using errcode = '22023';
  end if;

  select count(*),
         count(*) filter (
           where r.stock_item_id is not null and r.quantity > 0
             and r.quantity = round(r.quantity, 3)
             and coalesce(r.unit_cost, 0) >= 0
             and coalesce(r.unit_cost, 0) = round(coalesce(r.unit_cost, 0), 2)
             and si.id is not null
         )
    into v_count, v_valid
    from jsonb_to_recordset(p_items)
      as r(stock_item_id uuid, quantity numeric, unit_cost numeric)
    left join public.stock_items si
      on si.id = r.stock_item_id and si.business_id = p_business_id and si.is_active;

  if v_count <> jsonb_array_length(p_items) or v_valid <> v_count
    or (select count(distinct (e ->> 'stock_item_id'))
        from jsonb_array_elements(p_items) e) <> v_count
  then
    raise exception 'Choose unique products with valid quantities and costs'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('po:' || p_business_id::text, 0));
  select 'PO-' || lpad((count(*) + 1)::text, 5, '0') into v_number
    from public.purchase_orders where business_id = p_business_id;

  insert into public.purchase_orders (
    business_id, po_number, supplier_id, notes, created_by
  ) values (
    p_business_id, v_number, p_supplier_id, v_notes, auth.uid()
  ) returning id into v_id;

  insert into public.purchase_order_items (
    business_id, purchase_order_id, stock_item_id, quantity_ordered,
    estimated_unit_cost
  )
  select p_business_id, v_id, r.stock_item_id, r.quantity,
         coalesce(r.unit_cost, 0)
  from jsonb_to_recordset(p_items)
    as r(stock_item_id uuid, quantity numeric, unit_cost numeric);

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_business_id, auth.uid(), 'purchase_order.created', 'purchase_order',
    v_id::text, jsonb_build_object('po_number', v_number, 'item_count', v_count)
  );

  return v_id;
end;
$$;

create or replace function public.review_purchase_order(
  p_po_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if not public.has_business_permission(v_po.business_id, 'purchasing.approve') then
    raise exception 'Purchase approval permission required' using errcode = '42501';
  end if;
  if v_po.status <> 'pending_approval' then
    raise exception 'This purchase order has already been reviewed'
      using errcode = '22023';
  end if;
  if not coalesce(p_approve, false) and v_reason is null then
    raise exception 'Give a reason for rejecting the order' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 300 then
    raise exception 'Reason can be up to 300 characters' using errcode = '22023';
  end if;

  update public.purchase_orders
    set status = case when p_approve then 'approved' else 'rejected' end::public.purchase_order_status,
        decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
    where id = p_po_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_po.business_id, auth.uid(),
    case when p_approve then 'purchase_order.approved' else 'purchase_order.rejected' end,
    'purchase_order', p_po_id::text, jsonb_build_object('po_number', v_po.po_number)
  );
end;
$$;

create or replace function public.cancel_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if not (
    public.has_business_permission(v_po.business_id, 'inventory.manage')
    or public.has_business_permission(v_po.business_id, 'purchasing.approve')
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_po.status not in ('pending_approval', 'approved') then
    raise exception 'Only an order that has not been received can be cancelled'
      using errcode = '22023';
  end if;

  update public.purchase_orders set status = 'cancelled' where id = p_po_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_po.business_id, auth.uid(), 'purchase_order.cancelled', 'purchase_order',
    p_po_id::text, jsonb_build_object('po_number', v_po.po_number)
  );
end;
$$;

create or replace function public.receive_purchase_item(
  p_po_item_id uuid,
  p_idempotency_key uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_batch_number text default null,
  p_expires_at date default null,
  p_reference_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.purchase_order_items%rowtype;
  v_po public.purchase_orders%rowtype;
  v_location_id uuid;
  v_receipt_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_item from public.purchase_order_items where id = p_po_item_id for update;
  if not found then
    raise exception 'Purchase order item not found' using errcode = 'P0002';
  end if;

  select * into v_po from public.purchase_orders where id = v_item.purchase_order_id for update;
  if not public.has_business_permission(v_po.business_id, 'inventory.manage') then
    raise exception 'Inventory management permission required' using errcode = '42501';
  end if;
  select r.id into v_receipt_id
    from public.stock_receipts r
    join public.purchase_order_receipts por on por.receipt_id = r.id
    where r.business_id = v_po.business_id
      and r.idempotency_key = p_idempotency_key
      and por.purchase_order_item_id = p_po_item_id;
  if found then
    return v_receipt_id;
  end if;

  if v_po.status not in ('approved', 'partially_received') then
    raise exception 'Only an approved purchase order can be received'
      using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0
    or p_quantity > v_item.quantity_ordered - v_item.quantity_received
  then
    raise exception 'Received quantity exceeds what is still outstanding'
      using errcode = '22023';
  end if;

  select l.id into v_location_id
    from public.stock_locations l
    where l.business_id = v_po.business_id
      and l.location_type = 'central' and l.is_active
    limit 1;
  if v_location_id is null then
    raise exception 'No central stock location is configured' using errcode = '22023';
  end if;

  v_receipt_id := public.receive_stock(
    v_po.business_id, p_idempotency_key, v_item.stock_item_id, v_location_id,
    p_quantity, p_unit_cost, v_po.supplier_id, p_batch_number, p_expires_at,
    coalesce(nullif(btrim(p_reference_number), ''), v_po.po_number)
  );

  insert into public.purchase_order_receipts (
    receipt_id, business_id, purchase_order_item_id, quantity
  ) values (v_receipt_id, v_po.business_id, p_po_item_id, p_quantity)
  on conflict (receipt_id) do nothing;

  if found then
    update public.purchase_order_items
      set quantity_received = quantity_received + p_quantity
      where id = p_po_item_id;

    update public.purchase_orders
      set status = case
        when exists (
          select 1 from public.purchase_order_items i
          where i.purchase_order_id = v_po.id
            and i.quantity_received < i.quantity_ordered
        ) then 'partially_received' else 'received'
      end::public.purchase_order_status
      where id = v_po.id;
  end if;

  return v_receipt_id;
end;
$$;

revoke all on function public.create_purchase_order(uuid, uuid, text, jsonb)
  from public, anon;
revoke all on function public.review_purchase_order(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_purchase_order(uuid) from public, anon;
revoke all on function public.receive_purchase_item(
  uuid, uuid, numeric, numeric, text, date, text
) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.review_purchase_order(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_purchase_order(uuid) to authenticated;
grant execute on function public.receive_purchase_item(
  uuid, uuid, numeric, numeric, text, date, text
) to authenticated;
