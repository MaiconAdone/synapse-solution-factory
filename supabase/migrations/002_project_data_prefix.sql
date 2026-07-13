alter table public.projects
add column if not exists data_storage_prefix varchar(260);

update public.projects
set data_storage_prefix = storage_prefix || '/data'
where data_storage_prefix is null;

alter table public.projects
alter column data_storage_prefix set not null;

drop policy if exists "SYNAPSE_storage_select_approved" on storage.objects;
create policy "SYNAPSE_storage_select_approved"
on storage.objects
for select
using (bucket_id = 'SYNAPSE-projects' and public.is_SYNAPSE_approved());

drop policy if exists "SYNAPSE_storage_insert_approved" on storage.objects;
create policy "SYNAPSE_storage_insert_approved"
on storage.objects
for insert
with check (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and name like 'projects/%/data/%'
);

drop policy if exists "SYNAPSE_storage_update_approved" on storage.objects;
create policy "SYNAPSE_storage_update_approved"
on storage.objects
for update
using (bucket_id = 'SYNAPSE-projects' and public.is_SYNAPSE_approved())
with check (
  bucket_id = 'SYNAPSE-projects'
  and public.is_SYNAPSE_approved()
  and name like 'projects/%/data/%'
);
