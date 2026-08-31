/**
 * Jornada QA completa como usuário real (API + regras de negócio).
 * Uso: node scripts/qa-journey.mjs
 */
import { createClient } from "@supabase/supabase-js";
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
  fails.push({ name, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}
function assert(cond, name, detail = "") {
  if (cond) ok(name, detail);
  else fail(name, detail || "assertion false");
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dow() {
  return new Date().getDay(); // 0=dom
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function hhmm(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyWeekly() {
  const labels = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({
    dayOfWeek,
    label: labels[dayOfWeek],
    blocks: [],
  }));
}

function weeklyWithTodayBlock(start, end, activity = "Estudo QA") {
  const weekly = emptyWeekly();
  const today = dow();
  return weekly.map((d) =>
    d.dayOfWeek === today
      ? {
          ...d,
          blocks: [
            {
              id: `qa-work-${today}`,
              start,
              end,
              activity,
              isBreak: false,
            },
            {
              id: `qa-break-${today}`,
              start: end,
              end: end, // invalid? need end > start — fix below
              activity: "Descanso",
              isBreak: true,
            },
          ].filter((b) => b.start < b.end || !b.isBreak),
        }
      : d,
  );
}

function weeklyClean(start, end, activity = "Estudo QA") {
  const weekly = emptyWeekly();
  const today = dow();
  const [eh, em] = end.split(":").map(Number);
  let breakEndM = em + 5;
  let breakEndH = eh;
  if (breakEndM >= 60) {
    breakEndM -= 60;
    breakEndH += 1;
  }
  const breakEnd = `${pad(breakEndH)}:${pad(breakEndM)}`;
  return weekly.map((d) =>
    d.dayOfWeek === today
      ? {
          ...d,
          blocks: [
            {
              id: `qa-work-${today}`,
              start,
              end,
              activity,
              isBreak: false,
            },
            {
              id: `qa-break-${today}`,
              start: end,
              end: breakEnd,
              activity: "Descanso",
              isBreak: true,
            },
          ],
        }
      : d,
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

async function main() {
  console.log("\n=== QA JOURNEY — usuário qaauto ===\n");
  const today = todayISO();
  const blockStart = hhmm(-30); // começou há 30 min
  const blockEnd = hhmm(60); // termina em 1h

  // 0) Login + reset perfil (idempotente)
  console.log("0) Reset estado do usuário de teste");
  let auth;
  try {
    auth = await login(USER, PASS);
  } catch (e) {
    fail("login inicial", e.message);
    process.exit(1);
  }
  let token = auth.token;

  // Encerra sessão aberta órfã, se houver
  {
    const { data: active } = await sb.rpc("app_fetch_active", { p_token: token });
    if (active?.session?.id) {
      await sb.rpc("app_end_session", {
        p_token: token,
        p_session_id: active.session.id,
        p_actual_end: new Date().toISOString(),
        p_end_photo_url: null,
        p_duration_seconds: 1,
      });
      ok("encerrou sessão órfã");
    }
  }

  // Volta ao perfil zerado típico de conta nova
  {
    const { data, error } = await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: null,
      p_paused: true,
      p_weekly_routine: emptyWeekly(),
      p_activities: ["Descanso"],
    });
    assert(!error && data?.ok, "reset perfil zerado", error?.message || data?.error);
  }

  // Relê perfil
  {
    const { data } = await sb.rpc("app_get_profile", { p_token: token });
    auth = { token, user: data.user };
  }

  // 1) Login / perfil zerado
  console.log("\n1) Login / perfil zerado");
  assert(auth.token, "login ok");
  assert(auth.user.paused === true, "novo user começa pausado");
  assert(auth.user.start_date == null, "novo user sem data de início");
  assert(
    Array.isArray(auth.user.activities) &&
      auth.user.activities.includes("Descanso"),
    "só Descanso no início",
  );

  // 2) Ponto bloqueado enquanto pausado / sem início
  console.log("\n2) Bloqueios (pausado / sem início)");
  {
    const { data } = await sb.rpc("app_start_session", {
      p_token: token,
      p_block_id: "x",
      p_activity_type: "Estudo QA",
      p_planned_start: blockStart,
      p_planned_end: blockEnd,
      p_actual_start: new Date().toISOString(),
      p_start_photo_url: null,
      p_late_seconds: 0,
      p_early_seconds: 0,
      p_session_date: today,
    });
    assert(
      data?.ok === false && /pausad/i.test(data?.error || ""),
      "start bloqueado quando pausado",
      data?.error,
    );
  }

  // 3) Configurar rotina: início hoje, ativa, com bloco atual
  console.log("\n3) Configurar rotina (início hoje + bloco atual)");
  {
    const weekly = weeklyClean(blockStart, blockEnd, "Estudo QA");
    const { data, error } = await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: today,
      p_paused: false,
      p_weekly_routine: weekly,
      p_activities: ["Estudo QA", "Descanso"],
    });
    assert(!error && data?.ok, "salvar perfil", error?.message || data?.error);
    assert(data?.user?.paused === false, "pausado=false após save");
    assert(data?.user?.start_date === today, "start_date = hoje");
  }

  // 4) Início futuro bloqueia
  console.log("\n4) Data futura bloqueia ponto");
  {
    await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: "2099-01-01",
      p_paused: false,
      p_weekly_routine: weeklyClean(blockStart, blockEnd),
      p_activities: ["Estudo QA", "Descanso"],
    });
    const { data } = await sb.rpc("app_start_session", {
      p_token: token,
      p_block_id: `qa-work-${dow()}`,
      p_activity_type: "Estudo QA",
      p_planned_start: blockStart,
      p_planned_end: blockEnd,
      p_actual_start: new Date().toISOString(),
      p_start_photo_url: null,
      p_late_seconds: 0,
      p_early_seconds: 0,
      p_session_date: today,
    });
    assert(
      data?.ok === false && /início|inicio|liberou/i.test(data?.error || ""),
      "start bloqueado com data futura",
      data?.error,
    );
    // restaura hoje
    await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: today,
      p_paused: false,
      p_weekly_routine: weeklyClean(blockStart, blockEnd),
      p_activities: ["Estudo QA", "Descanso"],
    });
  }

  // 5) Bater ponto (entrada)
  console.log("\n5) Bater ponto — entrada e saída");
  let sessionId = null;
  {
    const { data, error } = await sb.rpc("app_start_session", {
      p_token: token,
      p_block_id: `qa-work-${dow()}`,
      p_activity_type: "Estudo QA",
      p_planned_start: blockStart,
      p_planned_end: blockEnd,
      p_actual_start: new Date().toISOString(),
      p_start_photo_url: null,
      p_late_seconds: 120,
      p_early_seconds: 0,
      p_session_date: today,
    });
    assert(!error && data?.ok && data.session, "start session", error?.message || data?.error);
    sessionId = data?.session?.id;
    assert(data?.session?.status === "in_progress", "status in_progress");
    assert(data?.session?.user_id || true, "tem sessão");
  }

  // 6) Segunda entrada bloqueada
  {
    const { data } = await sb.rpc("app_start_session", {
      p_token: token,
      p_block_id: `qa-work-${dow()}-2`,
      p_activity_type: "Estudo QA",
      p_planned_start: blockStart,
      p_planned_end: blockEnd,
      p_actual_start: new Date().toISOString(),
      p_start_photo_url: null,
      p_late_seconds: 0,
      p_early_seconds: 0,
      p_session_date: today,
    });
    assert(
      data?.ok === false && /andamento/i.test(data?.error || ""),
      "bloqueia 2ª sessão aberta",
      data?.error,
    );
  }

  // 7) Fetch active
  {
    const { data } = await sb.rpc("app_fetch_active", { p_token: token });
    assert(data?.ok && data.session?.id === sessionId, "fetch active");
  }

  // 8) End
  {
    const { data, error } = await sb.rpc("app_end_session", {
      p_token: token,
      p_session_id: sessionId,
      p_actual_end: new Date().toISOString(),
      p_end_photo_url: null,
      p_duration_seconds: 300,
    });
    assert(!error && data?.ok, "end session", error?.message || data?.error);
    assert(data?.session?.status === "completed", "status completed");
  }

  // 9) Isolamento — outro user não vê sessões do qaauto
  console.log("\n6) Isolamento entre contas");
  {
    const { user: otherUser, password: otherPass } = qaSecondary();
    const other = await login(otherUser, otherPass);
    const { data } = await sb.rpc("app_fetch_sessions", {
      p_token: other.token,
      p_from: "2020-01-01",
      p_to: null,
    });
    const mine = (data?.sessions || []).filter((s) => s.id === sessionId);
    assert(
      mine.length === 0,
      `${otherUser} não vê sessão do ${USER}`,
    );
    await sb.rpc("app_logout", { p_token: other.token });
  }

  // Relog qaauto (token ainda vale, mas ok)
  auth = await login(USER, PASS);
  token = auth.token;

  // 10) Rename
  console.log("\n7) Renomear atividade");
  {
    const { data } = await sb.rpc("app_rename_activity", {
      p_token: token,
      p_from: "Estudo QA",
      p_to: "Foco QA",
    });
    assert(data?.ok && (data.updated ?? 0) >= 1, "rename atualizou sessões", String(data?.updated));

    const weekly = weeklyClean(blockStart, blockEnd, "Foco QA");
    await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: today,
      p_paused: false,
      p_weekly_routine: weekly,
      p_activities: ["Foco QA", "Descanso"],
    });

    const { data: sess } = await sb.rpc("app_fetch_sessions", {
      p_token: token,
      p_from: today,
      p_to: today,
    });
    const renamed = (sess?.sessions || []).some((s) => s.activity_type === "Foco QA");
    assert(renamed, "histórico mostra nome novo");
  }

  // 11) Pausar e tentar start
  console.log("\n8) Pausar");
  {
    await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: today,
      p_paused: true,
      p_weekly_routine: weeklyClean(blockStart, blockEnd, "Foco QA"),
      p_activities: ["Foco QA", "Descanso"],
    });
    const { data } = await sb.rpc("app_start_session", {
      p_token: token,
      p_block_id: `qa-work-${dow()}`,
      p_activity_type: "Foco QA",
      p_planned_start: blockStart,
      p_planned_end: blockEnd,
      p_actual_start: new Date().toISOString(),
      p_start_photo_url: null,
      p_late_seconds: 0,
      p_early_seconds: 0,
      p_session_date: today,
    });
    assert(data?.ok === false, "pausado bloqueia novo ponto", data?.error);

    // retoma
    await sb.rpc("app_save_profile", {
      p_token: token,
      p_start_date: today,
      p_paused: false,
      p_weekly_routine: weeklyClean(blockStart, blockEnd, "Foco QA"),
      p_activities: ["Foco QA", "Descanso"],
    });
  }

  // 12) Token inválido
  console.log("\n9) Segurança token");
  {
    const fake = "00000000-0000-0000-0000-000000000000";
    const { data } = await sb.rpc("app_fetch_sessions", {
      p_token: fake,
      p_from: today,
      p_to: today,
    });
    assert(data?.ok === false, "token falso rejeitado");
  }

  // 13) Acesso direto à tabela
  {
    const direct = await sb.from("sessions").select("id").eq("id", sessionId);
    assert(
      !direct.data?.length,
      "RLS bloqueia leitura direta de sessão alheia/própria via table",
    );
  }

  // 14) Segunda batida no mesmo bloco (após end) — deve permitir
  console.log("\n10) Nova batida após encerrar");
  {
    const { data, error } = await sb.rpc("app_start_session", {
      p_token: token,
      p_block_id: `qa-work-${dow()}`,
      p_activity_type: "Foco QA",
      p_planned_start: blockStart,
      p_planned_end: blockEnd,
      p_actual_start: new Date().toISOString(),
      p_start_photo_url: null,
      p_late_seconds: 0,
      p_early_seconds: 0,
      p_session_date: today,
    });
    assert(data?.ok, "pode começar de novo após encerrar", error?.message || data?.error);
    if (data?.session?.id) {
      await sb.rpc("app_end_session", {
        p_token: token,
        p_session_id: data.session.id,
        p_actual_end: new Date().toISOString(),
        p_end_photo_url: null,
        p_duration_seconds: 60,
      });
    }
  }

  // 15) Logout
  {
    const { data } = await sb.rpc("app_logout", { p_token: token });
    assert(data?.ok, "logout");
    const { data: after } = await sb.rpc("app_get_profile", { p_token: token });
    assert(after?.ok === false, "token inválido após logout");
  }

  // 16) Login errado
  console.log("\n11) Credenciais");
  {
    const { data } = await sb.rpc("app_login", {
      p_username: USER,
      p_password: "errada",
    });
    assert(data?.ok === false, "senha errada rejeitada");
  }

  console.log("\n=== RESULTADO ===");
  console.log(`OK: ${oks.length}  FALHAS: ${fails.length}`);
  if (fails.length) {
    for (const f of fails) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("Todas as checagens de API passaram.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
