import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  let k = t.slice(0, i);
  let v = t.slice(i + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const policies = await client.query(`
  select schemaname, tablename, policyname, cmd, qual, with_check
  from pg_policies
  where tablename in ('objects','sessions')
     or policyname ilike '%session%'
  order by tablename, policyname
`);
console.log("policies:", JSON.stringify(policies.rows, null, 2));

const buckets = await client.query(
  `select id, name, public from storage.buckets where name='session-photos'`,
);
console.log("bucket", buckets.rows);

await client.end();
