-- PontoFoko — multi-usuário (contas isoladas)
create extension if not exists "pgcrypto" with schema extensions;

create table if not exists public.app_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  start_date date,
  paused boolean not null default true,
  weekly_routine jsonb not null default '[]'::jsonb,
  activities jsonb not null default '["Descanso"]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_accounts_username_idx
  on public.app_accounts (lower(username));

alter table public.app_accounts enable row level security;
drop policy if exists "app_accounts_no_direct" on public.app_accounts;
drop policy if exists "app_accounts_select_public" on public.app_accounts;
create policy "app_accounts_no_direct"
  on public.app_accounts for all using (false) with check (false);

create table if not exists public.app_auth_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days')
);

create index if not exists app_auth_sessions_user_idx
  on public.app_auth_sessions (user_id);

alter table public.app_auth_sessions enable row level security;
drop policy if exists "app_auth_sessions_no_direct" on public.app_auth_sessions;
create policy "app_auth_sessions_no_direct"
  on public.app_auth_sessions for all using (false) with check (false);

alter table public.sessions
  add column if not exists user_id uuid references public.app_accounts(id) on delete cascade;

create index if not exists sessions_user_date_idx
  on public.sessions (user_id, session_date desc);

create or replace function public._app_user_json(acct public.app_accounts)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', acct.id,
    'username', acct.username,
    'display_name', acct.display_name,
    'start_date', acct.start_date,
    'paused', acct.paused,
    'weekly_routine', acct.weekly_routine,
    'activities', acct.activities
  );
$$;

create or replace function public.app_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acct public.app_accounts%rowtype;
  sess_token uuid;
begin
  select * into acct
  from public.app_accounts
  where lower(username) = lower(trim(p_username))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Usuário ou senha inválidos.');
  end if;

  if acct.password_hash is distinct from crypt(p_password, acct.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'Usuário ou senha inválidos.');
  end if;

  insert into public.app_auth_sessions (user_id)
  values (acct.id)
  returning token into sess_token;

  return jsonb_build_object(
    'ok', true,
    'token', sess_token,
    'user', public._app_user_json(acct)
  );
end;
$$;

create or replace function public.app_logout(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.app_auth_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.app_get_profile(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acct public.app_accounts%rowtype;
begin
  select a.* into acct
  from public.app_auth_sessions s
  join public.app_accounts a on a.id = s.user_id
  where s.token = p_token
    and s.expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  return jsonb_build_object('ok', true, 'user', public._app_user_json(acct));
end;
$$;

create or replace function public.app_save_profile(
  p_token uuid,
  p_start_date date,
  p_paused boolean,
  p_weekly_routine jsonb,
  p_activities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  acct public.app_accounts%rowtype;
begin
  select user_id into uid
  from public.app_auth_sessions
  where token = p_token and expires_at > now();

  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  update public.app_accounts set
    start_date = p_start_date,
    paused = coalesce(p_paused, paused),
    weekly_routine = coalesce(p_weekly_routine, weekly_routine),
    activities = coalesce(p_activities, activities),
    updated_at = now()
  where id = uid
  returning * into acct;

  return jsonb_build_object('ok', true, 'user', public._app_user_json(acct));
end;
$$;

revoke all on function public.app_login(text, text) from public;
revoke all on function public.app_logout(uuid) from public;
revoke all on function public.app_get_profile(uuid) from public;
revoke all on function public.app_save_profile(uuid, date, boolean, jsonb, jsonb) from public;

grant execute on function public.app_login(text, text) to anon, authenticated;
grant execute on function public.app_logout(uuid) to anon, authenticated;
grant execute on function public.app_get_profile(uuid) to anon, authenticated;
grant execute on function public.app_save_profile(uuid, date, boolean, jsonb, jsonb) to anon, authenticated;
