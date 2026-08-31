import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv, projectRoot } from "./load-env.mjs";
import { defaultRoutine, defaultActivities } from "./default-routine.mjs";
import { blankProfile } from "./user-defaults.mjs";

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
  const sql = fs.readFileSync(
    path.join(projectRoot, "supabase", "multiuser.sql"),
    "utf8",
  );
  await client.query(sql);
  console.log("Schema multi-user ok.");

  await client.query("delete from public.sessions");
  console.log("Sessões antigas apagadas.");

  async function upsertUser({
    username,
    password,
    displayName,
    startDate,
    paused,
    weekly,
    activities,
  }) {
    const existing = await client.query(
      "select id from public.app_accounts where lower(username)=lower($1)",
      [username],
    );
    if (existing.rowCount > 0) {
      await client.query(
        `update public.app_accounts set
          password_hash = extensions.crypt($2, extensions.gen_salt('bf')),
          display_name = $3,
          start_date = $4,
          paused = $5,
          weekly_routine = $6::jsonb,
          activities = $7::jsonb,
          updated_at = now()
        where id = $1`,
        [
          existing.rows[0].id,
          password,
          displayName,
          startDate,
          paused,
          JSON.stringify(weekly),
          JSON.stringify(activities),
        ],
      );
      console.log(`Atualizado: ${username}`);
      return existing.rows[0].id;
    }
    const inserted = await client.query(
      `insert into public.app_accounts
        (username, password_hash, display_name, start_date, paused, weekly_routine, activities)
       values ($1, extensions.crypt($2, extensions.gen_salt('bf')), $3, $4, $5, $6::jsonb, $7::jsonb)
       returning id`,
      [
        username,
        password,
        displayName,
        startDate,
        paused,
        JSON.stringify(weekly),
        JSON.stringify(activities),
      ],
    );
    console.log(`Criado: ${username}`);
    return inserted.rows[0].id;
  }

  const demoUser = process.env.SEED_DEMO_USER?.trim();
  const demoPass = process.env.SEED_DEMO_PASSWORD;
  const demoName = process.env.SEED_DEMO_NAME?.trim() || "Demo";

  if (demoUser && demoPass) {
    await upsertUser({
      username: demoUser,
      password: demoPass,
      displayName: demoName,
      startDate: new Date().toISOString().slice(0, 10),
      paused: false,
      weekly: defaultRoutine,
      activities: defaultActivities,
    });
  } else {
    console.log(
      "Nenhum usuário seed (opcional): defina SEED_DEMO_USER e SEED_DEMO_PASSWORD no .env.local",
    );
    console.log('Ou crie manualmente: npm run db:user -- usuario senha "Nome"');
  }

  const blank = blankProfile();
  const qaUser = process.env.QA_USER?.trim() || "qaauto";
  const qaPass = process.env.QA_PASSWORD;
  if (qaPass) {
    await upsertUser({
      username: qaUser,
      password: qaPass,
      displayName: "QA Auto",
      startDate: blank.startDate,
      paused: blank.paused,
      weekly: blank.weekly,
      activities: blank.activities,
    });
  }

  console.log("Setup concluído.");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
