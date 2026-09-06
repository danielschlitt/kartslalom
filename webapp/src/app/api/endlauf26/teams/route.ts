import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { createClub, getKnownClubs } from "@/lib/dal/endlauf26";
import { championshipFromSlug } from "@/lib/endlauf26/ranking";

/**
 * Admin: add a club (ADAC Ortsclub) that is missing from the imported lists,
 * so it passes the Ortsclub check of future result imports.
 * Body: `{ championship: "hmj" | "adac-hth", name }`. Returns the full list.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as { championship?: unknown; name?: unknown };
  const championship = championshipFromSlug(String(body.championship ?? ""));
  if (!championship) {
    return NextResponse.json({ error: "invalid_championship" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 120) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }
  const res = await createClub(championship, name);
  const clubs = await getKnownClubs(championship);
  return NextResponse.json({ ok: true, ...res, clubs });
}
