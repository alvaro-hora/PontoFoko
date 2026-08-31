import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const connectionString =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL?.replace(":6543/", ":5432/").replace(
    "?pgbouncer=true",
    "",
  );

if (!connectionString) {
  console.error("Defina DIRECT_URL ou DATABASE_URL no .env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const settingsSql = fs.readFileSync(
    path.join(root, "supabase", "settings.sql"),
    "utf8",
  );
  await client.query(settingsSql);
  console.log("Tabela app_settings pronta.");

  const del = await client.query("delete from public.sessions returning id");
  console.log(`Sessões apagadas: ${del.rowCount ?? 0}`);
} catch (err) {
  console.error("Falha ao resetar banco:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (url && key) {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let removed = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from("session-photos")
      .list("", { limit: 100 });
    if (error) {
      console.warn("Storage list:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    // list may return folders (date prefixes)
    const folders = data.filter((f) => !f.id && f.name);
    const files = data.filter((f) => f.id);

    for (const folder of folders) {
      const { data: nested, error: nestErr } = await supabase.storage
        .from("session-photos")
        .list(folder.name, { limit: 1000 });
      if (nestErr) {
        console.warn("Storage nested:", nestErr.message);
        continue;
      }
      const paths = (nested ?? []).map((f) => `${folder.name}/${f.name}`);
      if (paths.length === 0) continue;
      const { error: rmErr } = await supabase.storage
        .from("session-photos")
        .remove(paths);
      if (rmErr) console.warn("Storage remove:", rmErr.message);
      else removed += paths.length;
    }

    if (files.length > 0) {
      const paths = files.map((f) => f.name);
      const { error: rmErr } = await supabase.storage
        .from("session-photos")
        .remove(paths);
      if (rmErr) console.warn("Storage remove:", rmErr.message);
      else removed += paths.length;
    }

    if (folders.length === 0 && files.length === 0) break;
    // avoid infinite loop if list keeps returning empty folders
    if (removed === 0 && folders.length > 0) {
      // try remove empty-looking entries once more then stop
      break;
    }
  }
  console.log(`Fotos removidas (aprox.): ${removed}`);
}

console.log("Reset concluído. Contagem vale a partir de 2026-08-10.");
