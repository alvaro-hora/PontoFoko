-- PontoFoko — settings + storage delete + limpeza
-- Pode rodar junto com migration.sql ou isolado

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
