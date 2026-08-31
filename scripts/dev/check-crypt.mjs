import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  let v = t.slice(eq + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = v;
}

const cs =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL.replace(":6543/", ":5432/").replace("?pgbouncer=true", "");

const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  select n.nspname, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('crypt', 'gen_salt')
`);
console.log("procs", r.rows);
const e = await c.query(`
  select e.extname, n.nspname
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
`);
console.log("exts", e.rows);
await c.end();
