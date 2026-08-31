import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { blankProfile } from "./user-defaults.mjs";

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

const [, , username, password, ...nameParts] = process.argv;
const displayName = nameParts.join(" ").trim() || username;

if (!username || !password) {
  console.log(`Uso:
  npm run db:user -- <usuario> <senha> "Nome para exibir"

Exemplo:
  npm run db:user -- maria senha123 "Maria Silva"

Acessos ficam estáticos no banco.
Usuário novo = perfil zerado (sem rotina, só Descanso; define início nos Ajustes).`);
  process.exit(1);
}

const blank = blankProfile();
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const existing = await client.query(
    "select id from public.app_accounts where lower(username)=lower($1)",
    [username],
  );
  if (existing.rowCount > 0) {
    console.error(`Já existe o usuário "${username}".`);
    process.exitCode = 1;
  } else {
    const { rows } = await client.query(
      `insert into public.app_accounts
        (username, password_hash, display_name, start_date, paused, weekly_routine, activities)
       values ($1, extensions.crypt($2, extensions.gen_salt('bf')), $3, $4, $5, $6::jsonb, $7::jsonb)
       returning id, username, display_name, start_date, paused`,
      [
        username.trim().toLowerCase(),
        password,
        displayName,
        blank.startDate,
        blank.paused,
        JSON.stringify(blank.weekly),
        JSON.stringify(blank.activities),
      ],
    );
    console.log("Usuário criado (perfil zerado):");
    console.log(rows[0]);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
