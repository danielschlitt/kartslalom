import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Lightweight admin gate (intentionally not a real auth system).
 *
 * The admin token comes from `ADMIN_TOKEN` (falls back to a well-known default
 * for local development). Once a browser has submitted the correct token via
 * `POST /api/auth/admin`, the token is stored in an HttpOnly cookie and every
 * admin page / mutating API route simply re-validates that cookie.
 */

export const ADMIN_COOKIE = "kartslalom_admin";
const DEFAULT_ADMIN_TOKEN = "qwerty123";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export function getAdminToken(): string {
  const configured = process.env.ADMIN_TOKEN?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_ADMIN_TOKEN;
}

export function isValidAdminToken(candidate: string | null | undefined): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(getAdminToken());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True when the current request carries a cookie with the correct admin token. */
export async function isAdminSession(): Promise<boolean> {
  const store = await cookies();
  return isValidAdminToken(store.get(ADMIN_COOKIE)?.value);
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/** Standard 401 response for protected API routes. */
export function unauthorizedResponse() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
