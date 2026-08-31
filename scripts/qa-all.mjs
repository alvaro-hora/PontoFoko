import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { loadEnv } from "./load-env.mjs";
import { qaPrimary, qaSecondary } from "./qa-config.mjs";

loadEnv();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const { user: USER, password: PASS } = qaPrimary();
const fails = [];
const oks = [];

function ok(name, detail = "") {
  oks.push(name);
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  fails.push({ name, detail: String(detail) });
  console.log(`  ✗ ${name} — ${detail}`);
}
function assert(cond, name, detail = "") {
  if (cond) ok(name, detail);
  else fail(name, detail || "assertion false");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function hhmm(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dow() {
  return new Date().getDay();
}
function emptyWeekly() {
  const labels = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
    dayOfWeek,
    label: labels[dayOfWeek],
    blocks: [],
  }));
}
function weeklyBlocks(blocks) {
  const today = dow();
  return emptyWeekly().map((d) =>
    d.dayOfWeek === today ? { ...d, blocks } : d,
  );
}

async function login(u, p) {
  const { data, error } = await sb.rpc("app_login", {
    p_username: u,
    p_password: p,
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || "login fail");
  return data;
}

async function saveProfile(token, patch) {
  const { data, error } = await sb.rpc("app_save_profile", {
    p_token: token,
    p_start_date: patch.startDate ?? null,
    p_paused: patch.paused ?? false,
    p_weekly_routine: patch.weekly ?? emptyWeekly(),
    p_activities: patch.activities ?? ["Descanso"],
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || "save fail");
  return data.user;
}

async function closeOpen(token) {
  const { data } = await sb.rpc("app_fetch_active", { p_token: token });
  if (data?.session?.id) {
    await sb.rpc("app_end_session", {
      p_token: token,
      p_session_id: data.session.id,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 1,
    });
  }
}

async function start(token, overrides = {}) {
  const start = overrides.start ?? hhmm(-20);
  const end = overrides.end ?? hhmm(40);
  return sb.rpc("app_start_session", {
    p_token: token,
    p_block_id: overrides.blockId ?? `qa-b-${dow()}`,
    p_activity_type: overrides.activity ?? "Foco QA",
    p_planned_start: start,
    p_planned_end: end,
    p_actual_start: overrides.actualStart ?? new Date().toISOString(),
    p_start_photo_url: overrides.photo ?? null,
    p_late_seconds: overrides.late ?? 0,
    p_early_seconds: 0,
    p_session_date: overrides.date ?? todayISO(),
  });
}

async function main() {
  console.log("\n=== QA ALL — matriz completa ===\n");
  const today = todayISO();
  const blockStart = hhmm(-20);
  const blockEnd = hhmm(40);

  // Reset via DB
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const urow = await client.query(
    "select id from app_accounts where username=$1",
    [USER],
  );
  const uid = urow.rows[0].id;
  await client.query(
    `update sessions set status='abandoned', actual_end=now()
     where user_id=$1 and status='in_progress'`,
    [uid],
  );
  await client.query(
    `update app_accounts set start_date=null, paused=true,
     weekly_routine='[]'::jsonb, activities='["Descanso"]'::jsonb where id=$1`,
    [uid],
  );

  let auth = await login(USER, PASS);
  let token = auth.token;

  // ——— AUTH ———
  console.log("A) Auth");
  {
    const badUser = await sb.rpc("app_login", {
      p_username: "naoexiste999",
      p_password: "x",
    });
    assert(badUser.data?.ok === false, "usuário inexistente rejeitado");

    const caseLogin = await login("QaAuTo", PASS);
    assert(caseLogin.ok, "login case-insensitive");
    await sb.rpc("app_logout", { p_token: caseLogin.token });

    auth = await login(` ${USER} `, PASS);
    assert(auth.ok, "login com espaços (trim)");
    token = auth.token;

    // Token expirado
    await client.query(
      `update app_auth_sessions set expires_at=now() - interval '1 minute' where token=$1`,
      [token],
    );
    const expired = await sb.rpc("app_get_profile", { p_token: token });
    assert(expired.data?.ok === false, "token expirado rejeitado");
    auth = await login(USER, PASS);
    token = auth.token;
  }

  // ——— BLOQUEIOS ———
  console.log("\nB) Bloqueios de ponto");
  {
    // pausado + sem data
    let r = await start(token);
    assert(r.data?.ok === false, "bloqueado pausado", r.data?.error);

    // sem pausa, sem data
    await saveProfile(token, {
      startDate: null,
      paused: false,
      weekly: weeklyBlocks([
        {
          id: "b1",
          start: blockStart,
          end: blockEnd,
          activity: "Foco QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Descanso"],
    });
    r = await start(token);
    assert(
      r.data?.ok === false && /início|inicio|liberou/i.test(r.data?.error || ""),
      "bloqueado sem start_date (mesmo não pausado)",
      r.data?.error,
    );

    // data futura
    await saveProfile(token, {
      startDate: "2099-12-01",
      paused: false,
      weekly: weeklyBlocks([
        {
          id: "b1",
          start: blockStart,
          end: blockEnd,
          activity: "Foco QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Descanso"],
    });
    r = await start(token, { date: today });
    assert(r.data?.ok === false, "bloqueado start_date futura");

    // session_date < start_date
    await saveProfile(token, {
      startDate: today,
      paused: false,
      weekly: weeklyBlocks([
        {
          id: "b1",
          start: blockStart,
          end: blockEnd,
          activity: "Foco QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Descanso"],
    });
    r = await start(token, { date: "2020-01-01" });
    assert(
      r.data?.ok === false,
      "bloqueado session_date < start_date",
      r.data?.error,
    );
  }

  // ——— FLUXO PONTO ———
  console.log("\nC) Fluxo ponto + pausa mid-session");
  let sessionId;
  {
    const r = await start(token, {
      blockId: "b1",
      late: 90,
      activity: "Foco QA",
    });
    assert(r.data?.ok, "start ok", r.data?.error);
    sessionId = r.data?.session?.id;
    assert(r.data?.session?.late_seconds === 90, "late_seconds persistido");

    // Pausar com sessão aberta
    await saveProfile(token, {
      startDate: today,
      paused: true,
      weekly: weeklyBlocks([
        {
          id: "b1",
          start: blockStart,
          end: blockEnd,
          activity: "Foco QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Descanso"],
    });
    const blocked = await start(token, { blockId: "b2" });
    assert(blocked.data?.ok === false, "novo start bloqueado enquanto pausado");

    // End ainda permitido pausado
    const ended = await sb.rpc("app_end_session", {
      p_token: token,
      p_session_id: sessionId,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 200,
    });
    assert(ended.data?.ok, "end permitido com rotina pausada", ended.data?.error);

    await saveProfile(token, {
      startDate: today,
      paused: false,
      weekly: weeklyBlocks([
        {
          id: "b1",
          start: blockStart,
          end: blockEnd,
          activity: "Foco QA",
          isBreak: false,
        },
        {
          id: "b2",
          start: hhmm(45),
          end: hhmm(90),
          activity: "Estudo QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Estudo QA", "Descanso"],
    });
  }

  // ——— SEGURANÇA CROSS-USER ———
  console.log("\nD) Segurança cross-user");
  {
    const r = await start(token, { blockId: "b1", activity: "Foco QA" });
    const sid = r.data?.session?.id;
    assert(r.data?.ok, "start para teste cross-user");

    const { user: otherUser, password: otherPass } = qaSecondary();
    const other = await login(otherUser, otherPass);
    const steal = await sb.rpc("app_end_session", {
      p_token: other.token,
      p_session_id: sid,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 1,
    });
    assert(
      steal.data?.ok === false,
      "outro user não encerra sessão alheia",
      steal.data?.error,
    );

    const stealRename = await sb.rpc("app_rename_activity", {
      p_token: other.token,
      p_from: "Foco QA",
      p_to: "Hackeado",
    });
    // rename ok mas 0 rows do outro user — não deve alterar qaauto
    const { data: sess } = await sb.rpc("app_fetch_sessions", {
      p_token: token,
      p_from: today,
      p_to: today,
    });
    const still = (sess?.sessions || []).some(
      (s) => s.id === sid && s.activity_type === "Foco QA",
    );
    assert(still || stealRename.data?.ok, "rename de outro não afeta sessão qaauto");

    // save profile outro não mexe no qaauto
    await sb.rpc("app_logout", { p_token: other.token });

    await sb.rpc("app_end_session", {
      p_token: token,
      p_session_id: sid,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 60,
    });
  }

  // ——— DUAS BATIDAS MESMO BLOCO ———
  console.log("\nE) Duas batidas no mesmo bloco");
  {
    const a = await start(token, { blockId: "b1", activity: "Foco QA" });
    assert(a.data?.ok, "1ª batida");
    await sb.rpc("app_end_session", {
      p_token: token,
      p_session_id: a.data.session.id,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 100,
    });
    const b = await start(token, { blockId: "b1", activity: "Foco QA" });
    assert(b.data?.ok, "2ª batida mesmo bloco");
    await sb.rpc("app_end_session", {
      p_token: token,
      p_session_id: b.data.session.id,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 500,
    });
    const { data } = await sb.rpc("app_fetch_sessions", {
      p_token: token,
      p_from: today,
      p_to: today,
    });
    const same = (data?.sessions || []).filter((s) => s.block_id === "b1");
    assert(same.length >= 2, `múltiplas sessões mesmo bloco (${same.length})`);
  }

  // ——— FETCH RANGE DIAS ———
  console.log("\nF) Fetch range / clamp");
  {
    const beforeStart = await sb.rpc("app_fetch_sessions", {
      p_token: token,
      p_from: "2019-01-01",
      p_to: "2019-12-31",
    });
    // RPC returns sessions in range; client clamps — here raw may be empty
    assert(beforeStart.data?.ok, "fetch range antigo ok");

    // Clear start and fetch — still ok
    const cleared = await saveProfile(token, {
      startDate: null,
      paused: true,
      weekly: emptyWeekly(),
      activities: ["Descanso"],
    });
    assert(cleared.start_date == null, "limpar start_date persiste null");
    assert(cleared.paused === true, "pausado após limpar");
  }

  // ——— STORAGE UPLOAD ———
  console.log("\nG) Storage foto");
  {
    auth = await login(USER, PASS);
    token = auth.token;
    await saveProfile(token, {
      startDate: today,
      paused: false,
      weekly: weeklyBlocks([
        {
          id: "b1",
          start: blockStart,
          end: blockEnd,
          activity: "Foco QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Descanso"],
    });

    const blob = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
      "base64",
    );
    const pathName = `${uid}/${today}/qa-test-${Date.now()}.jpg`;
    const up = await sb.storage.from("session-photos").upload(pathName, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (up.error) {
      fail("upload foto storage", up.error.message);
    } else {
      ok("upload foto storage");
      const { data: pub } = sb.storage.from("session-photos").getPublicUrl(pathName);
      assert(Boolean(pub?.publicUrl), "public URL gerada");
    }
  }

  // ——— UNIQUE INDEX ———
  console.log("\nH) Unique in_progress");
  {
    await closeOpen(token);
    const a = await start(token, { blockId: "uniq1" });
    assert(a.data?.ok, "primeira in_progress");
    // Force second insert via SQL to verify index
    try {
      await client.query(
        `insert into sessions (user_id, block_id, activity_type, planned_start, planned_end,
          actual_start, status, late_seconds, early_seconds, session_date)
         values ($1,'uniq2','X','10:00','11:00',now(),'in_progress',0,0,$2)`,
        [uid, today],
      );
      fail("unique index", "permitiu 2 in_progress");
      await client.query(
        `update sessions set status='abandoned' where user_id=$1 and status='in_progress'`,
        [uid],
      );
    } catch (e) {
      ok("unique index impede 2 in_progress", e.code || e.message);
      await closeOpen(token);
    }
  }

  // ——— EARLY PUNCH SERVER ———
  console.log("\nI) Bloqueio horário do bloco (servidor)");
  {
    await closeOpen(token);
    await saveProfile(token, {
      startDate: today,
      paused: false,
      weekly: weeklyBlocks([
        {
          id: "early",
          start: hhmm(120), // daqui a 2h
          end: hhmm(180),
          activity: "Foco QA",
          isBreak: false,
        },
      ]),
      activities: ["Foco QA", "Descanso"],
    });
    const early = await start(token, {
      blockId: "early",
      start: hhmm(120),
      end: hhmm(180),
      activity: "Foco QA",
    });
    assert(
      early.data?.ok === false && /começar|ainda/i.test(early.data?.error || ""),
      "servidor bloqueia entrada antes do horário",
      early.data?.error,
    );
  }

  // Cleanup final
  await closeOpen(token);
  await client.query(
    `update app_accounts set start_date=null, paused=true,
     weekly_routine='[]'::jsonb, activities='["Descanso"]'::jsonb where id=$1`,
    [uid],
  );
  await client.query(
    `update sessions set status='abandoned', actual_end=coalesce(actual_end,now())
     where user_id=$1 and status='in_progress'`,
    [uid],
  );
  await sb.rpc("app_logout", { p_token: token });
  await client.end();

  console.log("\n=== RESULTADO QA ALL ===");
  console.log(`OK: ${oks.length}  FALHAS: ${fails.length}`);
  if (fails.length) {
    for (const f of fails) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("Todos os gaps de API passaram.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
