import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env.mjs";

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const user = process.env.TEST_LOGIN_USER ?? process.env.QA_USER;
const pass = process.env.TEST_LOGIN_PASSWORD ?? process.env.QA_PASSWORD;

if (!user || !pass) {
  console.error(
    "Defina TEST_LOGIN_USER/TEST_LOGIN_PASSWORD ou QA_USER/QA_PASSWORD no .env.local",
  );
  process.exit(1);
}

const { data, error } = await supabase.rpc("app_login", {
  p_username: user,
  p_password: pass,
});
console.log(
  user,
  error?.message ?? null,
  data?.ok,
  data?.user?.display_name,
  data?.user?.start_date,
  data?.user?.paused,
);
