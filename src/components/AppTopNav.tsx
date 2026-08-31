"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, Gauge, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/components/providers";

const links = [
  { href: "/", label: "Ponto", icon: Clock3 },
  { href: "/dashboard/", label: "Pontualidade", icon: Gauge },
  { href: "/historico/", label: "Dias", icon: CalendarDays },
  { href: "/configuracao/", label: "Ajustes", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href.replace(/\/$/, ""));
}

export function AppTopNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <header className="app-topbar">
      <div className="app-topbar-inner">
        <Link href="/" className="brand">
          <Image
            src="/logo.png"
            alt="PontoFoko"
            width={36}
            height={36}
            className="brand-logo"
            priority
          />
          <span className="brand-text">
            <strong>PontoFoko</strong>
            <em>{user?.display_name ?? "Rotina"}</em>
          </span>
        </Link>

        <nav className="top-nav" aria-label="Principal">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={
                isActive(pathname, href) ? "nav-link is-active" : "nav-link"
              }
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </Link>
          ))}
          <button
            type="button"
            className="nav-link nav-logout"
            onClick={() => void logout()}
            title="Sair"
          >
            <LogOut size={18} strokeWidth={1.75} aria-hidden />
            <span>Sair</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
