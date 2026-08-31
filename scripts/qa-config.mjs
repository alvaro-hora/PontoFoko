import { loadEnv } from "./load-env.mjs";

loadEnv();

export function qaPrimary() {
  const user = process.env.QA_USER ?? "qaauto";
  const password = process.env.QA_PASSWORD;
  if (!password) {
    throw new Error(
      "Defina QA_PASSWORD no .env.local (veja .env.example).",
    );
  }
  return { user, password };
}

export function qaSecondary() {
  const user = process.env.QA_OTHER_USER;
  const password = process.env.QA_OTHER_PASSWORD;
  if (!user || !password) {
    throw new Error(
      "Defina QA_OTHER_USER e QA_OTHER_PASSWORD no .env.local para testes de isolamento.",
    );
  }
  return { user, password };
}
