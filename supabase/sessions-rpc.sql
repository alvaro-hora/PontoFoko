-- Sessões protegidas por token (isolamento real entre contas)
-- Fecha duplicatas abertas antes do índice único
do $$
begin
  with ranked as (
    select id,
           row_number() over (partition by user_id order by actual_start desc) as rn
    from public.sessions
    where status = 'in_progress' and user_id is not null
  )
  update public.sessions s
  set status = 'abandoned',
      actual_end = coalesce(s.actual_end, now()),
      duration_seconds = coalesce(
        s.duration_seconds,
        greatest(0, floor(extract(epoch from (now() - s.actual_start)))::int)
      )
  from ranked r
  where s.id = r.id and r.rn > 1;
end $$;

create or replace function public._app_uid_from_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
begin
  select user_id into uid
  from public.app_auth_sessions
  where token = p_token and expires_at > now();
  return uid;
end;
$$;

-- Uma sessão aberta por usuário
create unique index if not exists sessions_one_open_per_user
  on public.sessions (user_id)
  where status = 'in_progress';

-- Fechar acesso direto à tabela (só via RPC)
alter table public.sessions enable row level security;

drop policy if exists "sessions_select_all" on public.sessions;
drop policy if exists "sessions_insert_all" on public.sessions;
drop policy if exists "sessions_update_all" on public.sessions;
drop policy if exists "sessions_delete_all" on public.sessions;
drop policy if exists "sessions_deny_direct" on public.sessions;

create policy "sessions_deny_direct" on public.sessions
  for all using (false) with check (false);

-- Backfill / NOT NULL (só se não houver órfãs)
do $$
begin
  delete from public.sessions where user_id is null;
  alter table public.sessions alter column user_id set not null;
exception when others then
  raise notice 'user_id NOT NULL: %', SQLERRM;
end $$;

create or replace function public.app_fetch_sessions(
  p_token uuid,
  p_from date,
  p_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  rows jsonb;
begin
  uid := public._app_uid_from_token(p_token);
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.actual_start desc), '[]'::jsonb)
  into rows
  from public.sessions s
  where s.user_id = uid
    and s.session_date >= p_from
    and (p_to is null or s.session_date <= p_to);

  return jsonb_build_object('ok', true, 'sessions', rows);
end;
$$;

create or replace function public.app_fetch_active(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  row_data jsonb;
begin
  uid := public._app_uid_from_token(p_token);
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  select to_jsonb(s) into row_data
  from public.sessions s
  where s.user_id = uid and s.status = 'in_progress'
  order by s.actual_start desc
  limit 1;

  return jsonb_build_object('ok', true, 'session', row_data);
end;
$$;

create or replace function public.app_start_session(
  p_token uuid,
  p_block_id text,
  p_activity_type text,
  p_planned_start text,
  p_planned_end text,
  p_actual_start timestamptz,
  p_start_photo_url text,
  p_late_seconds integer,
  p_early_seconds integer,
  p_session_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  acct public.app_accounts%rowtype;
  row_data jsonb;
begin
  uid := public._app_uid_from_token(p_token);
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  select * into acct from public.app_accounts where id = uid;
  if acct.paused then
    return jsonb_build_object('ok', false, 'error', 'Rotina pausada. Retome nos Ajustes.');
  end if;
  if acct.start_date is null or p_session_date < acct.start_date then
    return jsonb_build_object('ok', false, 'error', 'Ainda não liberou a data de início.');
  end if;

  -- Horário local do app (Brasil): não permite entrada antes do início do bloco
  if (p_actual_start at time zone 'America/Sao_Paulo')::time < p_planned_start::time then
    return jsonb_build_object(
      'ok', false,
      'error', 'Ainda não — só pode começar a partir de ' || p_planned_start || '.'
    );
  end if;

  if exists (
    select 1 from public.sessions
    where user_id = uid and status = 'in_progress'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Já existe um ponto em andamento.');
  end if;

  insert into public.sessions (
    user_id, block_id, activity_type, planned_start, planned_end,
    actual_start, start_photo_url, status, late_seconds, early_seconds, session_date
  ) values (
    uid, p_block_id, p_activity_type, p_planned_start, p_planned_end,
    p_actual_start, p_start_photo_url, 'in_progress',
    coalesce(p_late_seconds, 0), coalesce(p_early_seconds, 0), p_session_date
  )
  returning to_jsonb(sessions.*) into row_data;

  return jsonb_build_object('ok', true, 'session', row_data);
end;
$$;

create or replace function public.app_end_session(
  p_token uuid,
  p_session_id uuid,
  p_actual_end timestamptz,
  p_end_photo_url text,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  row_data jsonb;
begin
  uid := public._app_uid_from_token(p_token);
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  update public.sessions set
    actual_end = p_actual_end,
    end_photo_url = p_end_photo_url,
    duration_seconds = p_duration_seconds,
    status = 'completed'
  where id = p_session_id and user_id = uid
  returning to_jsonb(sessions.*) into row_data;

  if row_data is null then
    return jsonb_build_object('ok', false, 'error', 'Registro não encontrado.');
  end if;

  return jsonb_build_object('ok', true, 'session', row_data);
end;
$$;

create or replace function public.app_rename_activity(
  p_token uuid,
  p_from text,
  p_to text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  n integer;
begin
  uid := public._app_uid_from_token(p_token);
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  update public.sessions
  set activity_type = p_to
  where user_id = uid and activity_type = p_from;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', true, 'updated', n);
end;
$$;

-- Ajuste manual de ponto (histórico): observação + origem
alter table public.sessions
  add column if not exists observation text,
  add column if not exists source text not null default 'live';

do $$
begin
  alter table public.sessions
    drop constraint if exists sessions_source_check;
  alter table public.sessions
    add constraint sessions_source_check
    check (source in ('live', 'manual', 'adjusted'));
exception when others then
  raise notice 'sessions_source_check: %', SQLERRM;
end $$;

create or replace function public.app_upsert_day_session(
  p_token uuid,
  p_session_id uuid,
  p_block_id text,
  p_activity_type text,
  p_planned_start text,
  p_planned_end text,
  p_session_date date,
  p_actual_start timestamptz,
  p_actual_end timestamptz,
  p_observation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  acct public.app_accounts%rowtype;
  row_data jsonb;
  dur integer;
  note text;
  existing_id uuid;
begin
  uid := public._app_uid_from_token(p_token);
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sessão expirada. Entre de novo.');
  end if;

  select * into acct from public.app_accounts where id = uid;
  if acct.start_date is null or p_session_date < acct.start_date then
    return jsonb_build_object('ok', false, 'error', 'Só dá para ajustar a partir da data de início.');
  end if;

  if p_session_date > (timezone('America/Sao_Paulo', now()))::date then
    return jsonb_build_object('ok', false, 'error', 'Não dá para registrar ponto em dia futuro.');
  end if;

  if p_actual_end <= p_actual_start then
    return jsonb_build_object('ok', false, 'error', 'O fim precisa ser depois do começo.');
  end if;

  if p_block_id is null or length(trim(p_block_id)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Bloco inválido.');
  end if;

  if p_activity_type is null or length(trim(p_activity_type)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Atividade inválida.');
  end if;

  dur := greatest(
    0,
    floor(extract(epoch from (p_actual_end - p_actual_start)))::int
  );

  note := nullif(trim(coalesce(p_observation, '')), '');
  if note is not null and length(note) > 500 then
    return jsonb_build_object('ok', false, 'error', 'Observação muito longa (máx. 500).');
  end if;

  -- Atualiza sessão existente (por id ou pelo mesmo bloco/dia)
  existing_id := p_session_id;
  if existing_id is null then
    select s.id into existing_id
    from public.sessions s
    where s.user_id = uid
      and s.session_date = p_session_date
      and s.block_id = p_block_id
      and s.status in ('completed', 'in_progress')
    order by s.actual_start desc
    limit 1;
  end if;

  if existing_id is not null then
    update public.sessions set
      activity_type = trim(p_activity_type),
      planned_start = p_planned_start,
      planned_end = p_planned_end,
      actual_start = p_actual_start,
      actual_end = p_actual_end,
      duration_seconds = dur,
      status = 'completed',
      observation = note,
      source = case
        when source = 'live' then 'adjusted'
        else coalesce(source, 'adjusted')
      end
    where id = existing_id and user_id = uid
    returning to_jsonb(sessions.*) into row_data;

    if row_data is null then
      return jsonb_build_object('ok', false, 'error', 'Registro não encontrado.');
    end if;

    return jsonb_build_object('ok', true, 'session', row_data);
  end if;

  insert into public.sessions (
    user_id, block_id, activity_type, planned_start, planned_end,
    actual_start, actual_end, duration_seconds,
    start_photo_url, end_photo_url, status,
    late_seconds, early_seconds, session_date,
    observation, source
  ) values (
    uid, p_block_id, trim(p_activity_type), p_planned_start, p_planned_end,
    p_actual_start, p_actual_end, dur,
    null, null, 'completed',
    0, 0, p_session_date,
    note, 'manual'
  )
  returning to_jsonb(sessions.*) into row_data;

  return jsonb_build_object('ok', true, 'session', row_data);
end;
$$;

revoke all on function public._app_uid_from_token(uuid) from public;
revoke all on function public.app_fetch_sessions(uuid, date, date) from public;
revoke all on function public.app_fetch_active(uuid) from public;
revoke all on function public.app_start_session(uuid, text, text, text, text, timestamptz, text, integer, integer, date) from public;
revoke all on function public.app_end_session(uuid, uuid, timestamptz, text, integer) from public;
revoke all on function public.app_rename_activity(uuid, text, text) from public;
revoke all on function public.app_upsert_day_session(uuid, uuid, text, text, text, text, date, timestamptz, timestamptz, text) from public;

grant execute on function public.app_fetch_sessions(uuid, date, date) to anon, authenticated;
grant execute on function public.app_fetch_active(uuid) to anon, authenticated;
grant execute on function public.app_start_session(uuid, text, text, text, text, timestamptz, text, integer, integer, date) to anon, authenticated;
grant execute on function public.app_end_session(uuid, uuid, timestamptz, text, integer) to anon, authenticated;
grant execute on function public.app_rename_activity(uuid, text, text) to anon, authenticated;
grant execute on function public.app_upsert_day_session(uuid, uuid, text, text, text, text, date, timestamptz, timestamptz, text) to anon, authenticated;
