-- Private document storage. Files live in the private 'sangira-documents' bucket
-- under a path that encodes the owner:
--   b/<business_id>/<category>/<uuid>.<ext>      business documents
--   a/<application_id>/<category>/<uuid>.<ext>   documents attached to a pending application
-- Storage policies derive access from that path, so isolation holds even if the
-- application layer is bypassed. Files are immutable: no update or delete policy.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_category') then
    create type public.document_category as enum (
      'registration', 'verification', 'supplier_invoice', 'receipt'
    );
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sangira-documents', 'sangira-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

create table public.business_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete restrict,
  application_id uuid references public.business_applications (id) on delete restrict,
  category public.document_category not null,
  supplier_id uuid,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  original_name text not null check (char_length(original_name) between 1 and 160),
  mime_type text not null check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint document_owner_check check (
    (business_id is not null and application_id is null)
    or (
      business_id is null and application_id is not null
      and category in ('registration', 'verification')
    )
  ),
  constraint document_supplier_check check (
    supplier_id is null
    or (business_id is not null and category in ('supplier_invoice', 'receipt'))
  ),
  foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id) on delete restrict
);

create index business_documents_business_idx
  on public.business_documents (business_id, category, created_at desc);
create index business_documents_application_idx
  on public.business_documents (application_id, created_at desc);

-- Splits an object path into scope ('b'/'a'), owner uuid and category.
-- Returns nulls when the path does not match the expected layout.
create or replace function public.document_path_info(p_path text)
returns table (scope text, owner_id uuid, category public.document_category)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_path, '/');
begin
  if array_length(v_parts, 1) is distinct from 4
    or v_parts[1] not in ('b', 'a')
    or v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or v_parts[3] not in ('registration', 'verification', 'supplier_invoice', 'receipt')
    or v_parts[4] !~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
  then
    return;
  end if;

  scope := v_parts[1];
  owner_id := v_parts[2]::uuid;
  category := v_parts[3]::public.document_category;
  return next;
end;
$$;

create or replace function public.can_write_document(
  p_scope text,
  p_owner uuid,
  p_category public.document_category
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_scope is null then
    return false;
  end if;

  if p_scope = 'a' then
    return p_category in ('registration', 'verification')
      and exists (
        select 1 from public.business_applications a
        where a.id = p_owner
          and a.applicant_user_id = auth.uid()
          and a.status in ('submitted', 'under_review')
      );
  end if;

  if p_category in ('registration', 'verification') then
    return public.has_business_permission(p_owner, 'business.manage');
  end if;

  return public.has_business_permission(p_owner, 'inventory.manage')
    or (
      p_category = 'receipt'
      and public.has_business_permission(p_owner, 'payments.manage')
    );
end;
$$;

create or replace function public.can_read_document(
  p_scope text,
  p_owner uuid,
  p_category public.document_category
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_scope is null then
    return false;
  end if;

  if p_scope = 'a' then
    return public.is_platform_admin()
      or exists (
        select 1 from public.business_applications a
        where a.id = p_owner and a.applicant_user_id = auth.uid()
      );
  end if;

  if p_category in ('registration', 'verification') then
    return public.is_platform_admin()
      or public.has_business_permission(p_owner, 'business.manage');
  end if;

  return public.has_business_permission(p_owner, 'inventory.manage')
    or public.has_business_permission(p_owner, 'payments.manage')
    or public.has_business_permission(p_owner, 'reports.view');
end;
$$;

alter table public.business_documents enable row level security;

drop policy if exists "Authorized staff read document metadata" on public.business_documents;
create policy "Authorized staff read document metadata"
  on public.business_documents for select to authenticated
  using (
    (select public.can_read_document(
      case when business_id is not null then 'b' else 'a' end,
      coalesce(business_id, application_id),
      category
    ))
  );

revoke all on public.business_documents from anon, authenticated;
grant select on public.business_documents to authenticated;

drop policy if exists "Document uploads follow path permissions" on storage.objects;
create policy "Document uploads follow path permissions"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sangira-documents'
    and exists (
      select 1 from public.document_path_info(name) i
      where (select public.can_write_document(i.scope, i.owner_id, i.category))
    )
  );

drop policy if exists "Document reads follow path permissions" on storage.objects;
create policy "Document reads follow path permissions"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sangira-documents'
    and exists (
      select 1 from public.document_path_info(name) i
      where (select public.can_read_document(i.scope, i.owner_id, i.category))
    )
  );

create or replace function public.register_document(
  p_storage_path text,
  p_original_name text,
  p_supplier_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_info record;
  v_object record;
  v_name text := left(regexp_replace(btrim(p_original_name), '[[:cntrl:]/\\]', '_', 'g'), 160);
  v_size bigint;
  v_mime text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_info from public.document_path_info(p_storage_path);
  if v_info.scope is null
    or not public.can_write_document(v_info.scope, v_info.owner_id, v_info.category)
  then
    raise exception 'Not allowed to register this document' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) < 1 then
    raise exception 'A file name is required' using errcode = '22023';
  end if;

  -- Size and type come from the stored object, never from client input.
  select o.metadata into v_object
    from storage.objects o
    where o.bucket_id = 'sangira-documents' and o.name = p_storage_path;
  if not found then
    raise exception 'Uploaded file not found' using errcode = 'P0002';
  end if;

  v_size := (v_object.metadata ->> 'size')::bigint;
  v_mime := v_object.metadata ->> 'mimetype';

  insert into public.business_documents (
    business_id, application_id, category, supplier_id, storage_path,
    original_name, mime_type, size_bytes, uploaded_by
  ) values (
    case when v_info.scope = 'b' then v_info.owner_id end,
    case when v_info.scope = 'a' then v_info.owner_id end,
    v_info.category, p_supplier_id, p_storage_path,
    v_name, v_mime, v_size, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    case when v_info.scope = 'b' then v_info.owner_id end,
    auth.uid(), 'document.uploaded', 'document', v_id::text,
    jsonb_build_object('category', v_info.category::text, 'size_bytes', v_size,
      'scope', v_info.scope)
  );

  return v_id;
end;
$$;

create or replace function public.log_document_access(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.business_documents%rowtype;
begin
  select * into v_doc from public.business_documents where id = p_document_id;
  if not found or not public.can_read_document(
    case when v_doc.business_id is not null then 'b' else 'a' end,
    coalesce(v_doc.business_id, v_doc.application_id),
    v_doc.category
  ) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    business_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_doc.business_id, auth.uid(), 'document.accessed', 'document',
    p_document_id::text, jsonb_build_object('category', v_doc.category::text)
  );
end;
$$;

revoke all on function public.document_path_info(text) from public, anon;
revoke all on function public.can_write_document(text, uuid, public.document_category) from public, anon;
revoke all on function public.can_read_document(text, uuid, public.document_category) from public, anon;
revoke all on function public.register_document(text, text, uuid) from public, anon;
revoke all on function public.log_document_access(uuid) from public, anon;
grant execute on function public.document_path_info(text) to authenticated;
grant execute on function public.can_write_document(text, uuid, public.document_category) to authenticated;
grant execute on function public.can_read_document(text, uuid, public.document_category) to authenticated;
grant execute on function public.register_document(text, text, uuid) to authenticated;
grant execute on function public.log_document_access(uuid) to authenticated;
