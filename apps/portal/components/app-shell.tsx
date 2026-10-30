import Link from "next/link";
import {
  Boxes,
  Download,
  Gauge,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Package,
  Settings,
  Waves,
} from "lucide-react";
import { Brand } from "./brand";
import { RoleBadge } from "./status";
import { canAdminister, type SessionUser } from "@/lib/session";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/projects", label: "Projects", icon: Boxes },
  { href: "/get-started", label: "Get started", icon: Download },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/admin/harness", label: "Harness packs", icon: Package },
  { href: "/admin/tokens", label: "MCP tokens", icon: KeyRound },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  user,
  children,
  breadcrumbs = [],
}: {
  user: SessionUser;
  children: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}) {
  return (
    <div className="drawer lg:drawer-open">
      <input id="stack-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex min-h-screen flex-col">
        <header className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur">
          <div className="navbar-start gap-2">
            <label htmlFor="stack-drawer" className="btn btn-square btn-ghost btn-sm lg:hidden">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </label>
            {breadcrumbs.length > 0 && (
              <div className="breadcrumbs max-w-[60vw] text-sm">
                <ul>
                  {breadcrumbs.map((crumb) => (
                    <li key={crumb.label}>
                      {crumb.href ? (
                        <Link href={crumb.href} className="link-hover">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{crumb.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="navbar-end gap-3">
            <span className="hidden text-xs text-base-content/60 sm:inline">
              portal runs no AI · evidence only
            </span>
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-ghost btn-sm gap-2">
                <div className="avatar avatar-placeholder">
                  <div className="h-7 w-7 rounded-full bg-secondary text-secondary-content">
                    <span className="text-xs">
                      {user.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                  </div>
                </div>
                <span className="hidden sm:inline">{user.name}</span>
                <RoleBadge role={user.role} />
              </div>
              <ul className="dropdown-content menu z-40 mt-2 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                <li className="menu-title text-xs">{user.email}</li>
                <li>
                  <Link href="/settings/tokens">
                    <KeyRound size={16} /> My API tokens
                  </Link>
                </li>
                <li>
                  <form action="/api/auth/logout" method="post">
                    <button type="submit" className="w-full text-left">
                      <LogOut size={16} /> Sign out
                    </button>
                  </form>
                </li>
              </ul>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>

        <footer className="footer footer-center border-t border-base-300 bg-base-100 p-4 text-xs text-base-content/60">
          <aside>
            Stack AI · Miracle Software Systems · the portal holds the record, never the code
          </aside>
        </footer>
      </div>

      <aside className="drawer-side z-40">
        <label htmlFor="stack-drawer" aria-label="close sidebar" className="drawer-overlay" />
        <nav className="flex min-h-full w-72 flex-col border-r border-base-300 bg-base-100">
          <div className="flex h-16 items-center border-b border-base-300 px-4">
            <Brand />
          </div>

          <ul className="menu w-full gap-1 p-3">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>
                  <item.icon size={18} /> {item.label}
                </Link>
              </li>
            ))}
          </ul>

          {canAdminister(user.role) && (
            <>
              <div className="divider mx-3 my-1 text-xs text-base-content/50">Administration</div>
              <ul className="menu w-full gap-1 p-3 pt-0">
                {ADMIN_NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>
                      <item.icon size={18} /> {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-auto p-3">
            <div className="rounded-box border border-base-300 bg-base-200 p-3 text-xs">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <Waves size={14} className="text-primary" /> Two MCPs, one record
              </div>
              <p className="text-base-content/70">
                Developers pull work and report status. Planners submit plans and waves. Status moves
                on git evidence, and a person validates.
              </p>
            </div>
          </div>
        </nav>
      </aside>
    </div>
  );
}
