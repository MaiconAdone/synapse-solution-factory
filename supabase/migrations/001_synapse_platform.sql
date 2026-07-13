create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'viewer' check (role in ('admin', 'operator', 'viewer')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name varchar(80) not null unique,
  project_type varchar(120) not null,
  status varchar(40) not null default 'created',
  storage_backend varchar(40) not null default 'supabase',
  storage_bucket varchar(120),
  storage_prefix varchar(240) not null,
  data_storage_prefix varchar(260) not null,
  repository_url text,
  project_goal text,
  business_problem text,
  solution_focus varchar(80) not null default 'ai-ml-agents',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'maintainer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type varchar(80) not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);
create index if not exists idx_project_events_project_id on public.project_events(project_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_events enable row level security;

create or replace function public.is_SYNAPSE_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and approved = true
  );
$$;

create or replace function public.is_SYNAPSE_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and approved = true
  );
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
using (id = auth.uid() or public.is_SYNAPSE_admin());

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only"
on public.profiles
for update
using (public.is_SYNAPSE_admin())
with check (public.is_SYNAPSE_admin());

drop policy if exists "projects_select_approved" on public.projects;
create policy "projects_select_approved"
on public.projects
for select
using (
  public.is_SYNAPSE_admin()
  or (
    public.is_SYNAPSE_approved()
    and exists (
      select 1
      from public.project_members
      where project_members.project_id = projects.id
        and project_members.user_id = auth.uid()
    )
  )
);

drop policy if exists "projects_insert_approved" on public.projects;
create policy "projects_insert_approved"
on public.projects
for insert
with check (public.is_SYNAPSE_approved());

drop policy if exists "projects_update_admin_or_owner" on public.projects;
create policy "projects_update_admin_or_owner"
on public.projects
for update
using (
  public.is_SYNAPSE_admin()
  or exists (
    select 1
    from public.project_members
    where project_members.project_id = projects.id
      and project_members.user_id = auth.uid()
      and project_members.role in ('owner', 'maintainer')
  )
)
with check (public.is_SYNAPSE_approved());

drop policy if exists "project_members_select_approved" on public.project_members;
create policy "project_members_select_approved"
on public.project_members
for select
using (public.is_SYNAPSE_admin() or user_id = auth.uid());

drop policy if exists "project_members_admin_only" on public.project_members;
create policy "project_members_admin_only"
on public.project_members
for all
using (public.is_SYNAPSE_admin())
with check (public.is_SYNAPSE_admin());

drop policy if exists "project_events_select_approved" on public.project_events;
create policy "project_events_select_approved"
on public.project_events
for select
using (public.is_SYNAPSE_admin() or public.is_SYNAPSE_approved());

drop policy if exists "project_events_insert_approved" on public.project_events;
create policy "project_events_insert_approved"
on public.project_events
for insert
with check (public.is_SYNAPSE_approved());

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
