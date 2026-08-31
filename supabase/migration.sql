-- PontoFoko — schema inicial
-- Execute no SQL Editor do Supabase

create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  block_id text not null,
  activity_type text not null,
  planned_start text not null,
  planned_end text not null,
  actual_start timestamptz not null,
  actual_end timestamptz,
  duration_seconds integer,
  start_photo_url text,
  end_photo_url text,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  late_seconds integer not null default 0,
  early_seconds integer not null default 0,
  session_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_date_idx on public.sessions (session_date desc);
create index if not exists sessions_status_idx on public.sessions (status);
create index if not exists sessions_activity_idx on public.sessions (activity_type);

alter table public.sessions enable row level security;

drop policy if exists "sessions_select_all" on public.sessions;
drop policy if exists "sessions_insert_all" on public.sessions;
drop policy if exists "sessions_update_all" on public.sessions;
drop policy if exists "sessions_delete_all" on public.sessions;

create policy "sessions_select_all" on public.sessions for select using (true);
create policy "sessions_insert_all" on public.sessions for insert with check (true);
create policy "sessions_update_all" on public.sessions for update using (true);
create policy "sessions_delete_all" on public.sessions for delete using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-photos',
  'session-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "session_photos_public_read" on storage.objects;
drop policy if exists "session_photos_public_insert" on storage.objects;
drop policy if exists "session_photos_public_update" on storage.objects;

create policy "session_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'session-photos');

create policy "session_photos_public_insert"
  on storage.objects for insert
  with check (bucket_id = 'session-photos');

create policy "session_photos_public_update"
  on storage.objects for update
  using (bucket_id = 'session-photos');

-- Settings (rotina editável)
create table if not exists public.app_settings (
  id text primary key default 'default',
  weekly_routine jsonb not null default '[]'::jsonb,
  activities jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings
  add column if not exists activities jsonb not null default '[]'::jsonb;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_all" on public.app_settings;
drop policy if exists "app_settings_insert_all" on public.app_settings;
drop policy if exists "app_settings_update_all" on public.app_settings;
drop policy if exists "app_settings_delete_all" on public.app_settings;

create policy "app_settings_select_all" on public.app_settings for select using (true);
create policy "app_settings_insert_all" on public.app_settings for insert with check (true);
create policy "app_settings_update_all" on public.app_settings for update using (true);
create policy "app_settings_delete_all" on public.app_settings for delete using (true);

drop policy if exists "session_photos_public_delete" on storage.objects;
create policy "session_photos_public_delete"
  on storage.objects for delete
  using (bucket_id = 'session-photos');
