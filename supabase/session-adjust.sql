-- Migration isolada: ajuste manual de ponto no histórico
-- (também embutida em sessions-rpc.sql para reapply completo)

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

revoke all on function public.app_upsert_day_session(uuid, uuid, text, text, text, text, date, timestamptz, timestamptz, text) from public;
grant execute on function public.app_upsert_day_session(uuid, uuid, text, text, text, text, date, timestamptz, timestamptz, text) to anon, authenticated;
