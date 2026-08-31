import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

async function test(u, p) {
  const { data, error } = await sb.rpc("app_login", {
    p_username: u,
    p_password: p,
  });
  if (error) {
    console.log(u, "login err", error.message);
    return;
  }
  if (!data?.ok) {
    console.log(u, "fail", data);
    return;
  }
  const token = data.token;
  const f = await sb.rpc("app_fetch_sessions", {
    p_token: token,
    p_from: "2026-01-01",
    p_to: null,
  });
  const a = await sb.rpc("app_fetch_active", { p_token: token });
  const direct = await sb.from("sessions").select("id").limit(3);
  console.log(u, {
    login: true,
    sessionsOk: f.data?.ok,
    count: (f.data?.sessions || []).length,
    activeOk: a.data?.ok,
    directBlocked: Boolean(direct.error) || (direct.data?.length ?? 0) === 0,
    directError: direct.error?.message ?? null,
  });
  await sb.rpc("app_logout", { p_token: token });
}

const pairs = [];
const primaryUser = process.env.QA_USER ?? process.env.TEST_LOGIN_USER;
const primaryPass = process.env.QA_PASSWORD ?? process.env.TEST_LOGIN_PASSWORD;
if (primaryUser && primaryPass) pairs.push([primaryUser, primaryPass]);

const otherUser = process.env.QA_OTHER_USER;
const otherPass = process.env.QA_OTHER_PASSWORD;
if (otherUser && otherPass) pairs.push([otherUser, otherPass]);

if (pairs.length === 0) {
  console.error("Defina QA_USER/QA_PASSWORD (e opcionalmente QA_OTHER_*) no .env.local");
  process.exit(1);
}

for (const [u, p] of pairs) {
  await test(u, p);
}
