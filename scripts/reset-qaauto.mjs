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
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const u = await client.query(
  "select id, username, start_date, paused from app_accounts where username=$1",
  ["qaauto"],
);
console.log("user before", u.rows[0]);
const uid = u.rows[0].id;
const open = await client.query(
  "select id, status from sessions where user_id=$1 and status='in_progress'",
  [uid],
);
console.log("open sessions", open.rows);
if (open.rowCount > 0) {
  await client.query(
    `update sessions set status='abandoned', actual_end=now()
     where user_id=$1 and status='in_progress'`,
    [uid],
  );
  console.log("abandoned", open.rowCount);
}
await client.query(
  `update app_accounts set
     start_date=null,
     paused=true,
     weekly_routine='[]'::jsonb,
     activities='["Descanso"]'::jsonb
   where id=$1`,
  [uid],
);
const after = await client.query(
  "select username, start_date, paused from app_accounts where id=$1",
  [uid],
);
console.log("user after", after.rows[0]);
await client.end();
