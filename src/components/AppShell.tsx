"use client";

import type { ReactNode } from "react";
import { AppTopNav } from "@/components/AppTopNav";
import { useAuth } from "@/components/providers";
import { LoginScreen } from "@/components/LoginScreen";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, offline, token, refresh } = useAuth();

  if (!ready) {
    return <div className="dashboard-loading">Carregando…</div>;
  }

  // Token válido mas rede falhou no 1º load — não manda para login
  if (!user && token && offline) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="page-title" style={{ margin: 0 }}>
            Sem conexão
          </h1>
          <p className="period-caption" style={{ margin: 0 }}>
            Não deu para carregar sua conta. Verifique a internet e tente de
            novo — sua sessão continua salva.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void refresh()}
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="app-frame">
      <AppTopNav />
      <main className="app-main">{children}</main>
    </div>
  );
}
