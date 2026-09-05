import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  isAdminSession,
  isValidAdminToken,
} from "@/lib/admin-auth";

/** Is this browser currently unlocked as admin? */
export async function GET() {
  return NextResponse.json({ admin: await isAdminSession() });
}

/** Unlock: `{ token }` → sets the admin cookie when the token matches. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!isValidAdminToken(token)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
  return res;
}

/** Lock again: clears the admin cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
  return res;
}
