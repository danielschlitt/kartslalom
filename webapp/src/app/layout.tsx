import type { Metadata } from "next";
import Link from "next/link";
import { Flag, Trophy, Zap, Settings } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kartslalom Hessen-Thüringen Süd",
  description:
    "Live-Zeiten und Meisterschaftsstand der Kartslalom-Saison Hessen-Thüringen Süd",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Flag className="h-5 w-5 text-[var(--color-accent)]" />
              <span>Kartslalom Hessen-Thüringen Süd</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/" icon={<Flag className="h-4 w-4" />}>
                Rennen
              </NavLink>
              <NavLink
                href="/championship"
                icon={<Trophy className="h-4 w-4" />}
              >
                Meisterschaft
              </NavLink>
              <NavLink
                href="/championship/live"
                icon={<Zap className="h-4 w-4" />}
              >
                Live
              </NavLink>
              <NavLink href="/admin" icon={<Settings className="h-4 w-4" />}>
                Admin
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)]"
    >
      {icon}
      {children}
    </Link>
  );
}
