import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

const sqlPath = path.join(root, "supabase", "migration.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log("Migration aplicada com sucesso.");
} catch (err) {
  console.error("Falha na migration:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
