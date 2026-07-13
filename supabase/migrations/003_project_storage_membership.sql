create or replace function public.can_access_project_storage(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_SYNAPSE_admin()
  or exists (
    select 1
    from public.projects
    join public.project_members
      on project_members.project_id = projects.id
    where project_members.user_id = auth.uid()
      and object_name like projects.data_storage_prefix || '/%'
  );
$$;

drop policy if exists "SYNAPSE_storage_select_approved" on storage.objects;
drop policy if exists "SYNAPSE_storage_select_members" on storage.objects;
create policy "SYNAPSE_storage_select_members"
on storage.objects
for select
using (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and public.can_access_project_storage(name)
);

drop policy if exists "SYNAPSE_storage_insert_approved" on storage.objects;
drop policy if exists "SYNAPSE_storage_insert_members" on storage.objects;
create policy "SYNAPSE_storage_insert_members"
on storage.objects
for insert
with check (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and public.can_access_project_storage(name)
);

drop policy if exists "SYNAPSE_storage_update_approved" on storage.objects;
drop policy if exists "SYNAPSE_storage_update_members" on storage.objects;
create policy "SYNAPSE_storage_update_members"
on storage.objects
for update
using (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and public.can_access_project_storage(name)
)
with check (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and public.can_access_project_storage(name)
);

drop policy if exists "SYNAPSE_storage_delete_members" on storage.objects;
create policy "SYNAPSE_storage_delete_members"
on storage.objects
for delete
using (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and public.can_access_project_storage(name)
);
