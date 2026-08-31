"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/components/providers";

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="login-brand">
          <Image src="/logo.png" alt="" width={48} height={48} priority />
          <div>
            <strong>PontoFoko</strong>
            <em>Rotina</em>
          </div>
        </div>

        <label className="settings-field">
          <span>Usuário</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>

        <label className="settings-field">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="inline-error">{error}</p>}

        <button
          type="submit"
          className="btn btn-lg btn-primary"
          disabled={busy}
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>

        <p className="period-caption" style={{ margin: 0, textAlign: "center" }}>
          Acesso com usuário e senha cadastrados no sistema.
        </p>
      </form>
    </div>
  );
}
