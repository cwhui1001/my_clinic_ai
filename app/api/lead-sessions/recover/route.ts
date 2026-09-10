import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { rotateRecoveredGuestSession } from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { readJsonBody } from "@/src/server/http/read-json";

export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const schema = z.object({ token: z.string().min(32).max(512) }).strict();

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const parsed = body.success ? schema.safeParse(body.data) : null;
  if (!parsed?.success) return NextResponse.json({ state: "invalid" }, { status: 400, headers: HEADERS });
  try {
    const result = await rotateRecoveredGuestSession(parsed.data.token);
    const response = NextResponse.json({ state: result.state, next: result.state === "active" ? "/guest" : null }, { headers: HEADERS });
    if (result.state === "active" && result.recoveryToken && result.session) response.cookies.set(GUEST_SESSION_COOKIE, result.recoveryToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(result.session.expiresAt) });
    return response;
  } catch {
    return NextResponse.json({ state: "invalid" }, { status: 503, headers: HEADERS });
  }
}
