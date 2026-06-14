import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
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
        <header className="relative border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold">
              <Flag className="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
              <span className="truncate text-sm sm:text-base">
                Kartslalom Hessen-Thüringen Süd
              </span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
