import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

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

const deleteUser = process.argv.includes("--delete-user");
const QA_USER = "qaauto";

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows } = await client.query(
  "select id, username from app_accounts where lower(username)=lower($1)",
  [QA_USER],
);

if (rows.length === 0) {
  console.log("Conta qaauto não existe — nada a limpar.");
  await client.end();
  process.exit(0);
}

const uid = rows[0].id;
console.log("Limpando dados de", QA_USER, uid);

const delSess = await client.query(
  "delete from public.sessions where user_id=$1 returning id",
  [uid],
);
console.log("Sessões apagadas:", delSess.rowCount);

const delTok = await client.query(
  "delete from public.app_auth_sessions where user_id=$1 returning token",
  [uid],
);
console.log("Sessões de login apagadas:", delTok.rowCount);

// Liberar delete temporário no bucket, apagar via API, fechar de novo
await client.query(`
  drop policy if exists "session_photos_public_delete" on storage.objects;
  create policy "session_photos_public_delete"
    on storage.objects for delete
    using (bucket_id = 'session-photos');
`);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

async function listAll(prefix) {
  const { data, error } = await sb.storage.from("session-photos").list(prefix, {
    limit: 1000,
  });
  if (error) {
    console.log("list:", error.message);
    return [];
  }
  return data ?? [];
}

const toRemove = [];
const top = await listAll(uid);
for (const item of top) {
  // pastas não têm id de objeto
  if (!item.id && item.name) {
    const nested = await listAll(`${uid}/${item.name}`);
    for (const f of nested) {
      if (f.name) toRemove.push(`${uid}/${item.name}/${f.name}`);
    }
  } else if (item.name) {
    toRemove.push(`${uid}/${item.name}`);
  }
}

if (toRemove.length) {
  const { data, error } = await sb.storage
    .from("session-photos")
    .remove(toRemove);
  if (error) console.log("Erro ao apagar fotos:", error.message);
  else console.log("Fotos apagadas:", data?.length ?? toRemove.length);
} else {
  console.log("Nenhuma foto no storage.");
}

// Fechar delete de novo
await client.query(`
  drop policy if exists "session_photos_public_delete" on storage.objects;
`);
console.log("Policy de delete do storage fechada de novo.");

if (deleteUser) {
  await client.query("delete from public.app_accounts where id=$1", [uid]);
  console.log("Conta qaauto removida.");
} else {
  await client.query(
    `update public.app_accounts set
       start_date=null,
       paused=true,
       weekly_routine='[]'::jsonb,
       activities='["Descanso"]'::jsonb,
       updated_at=now()
     where id=$1`,
    [uid],
  );
  console.log("Perfil qaauto zerado (conta mantida).");
}

await client.end();
console.log("Limpeza concluída.");
