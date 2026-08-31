import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  let v = t.slice(eq + 1);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = v;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data, error, count } = await supabase
  .from("sessions")
  .select("id,session_date,status", { count: "exact" });

console.log("error", error?.message ?? null);
console.log("count", count ?? data?.length ?? 0);
console.log(
  "rows",
  (data ?? []).map((r) => `${r.session_date} ${r.status}`).join(" | ") || "(vazio)",
);

const { count: before } = await supabase
  .from("sessions")
  .select("id", { count: "exact", head: true })
  .lt("session_date", "2026-08-10");
console.log("before_2026-08-10", before ?? 0);
