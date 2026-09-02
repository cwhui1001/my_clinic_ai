import { NextRequest, NextResponse } from "next/server";

import { getLeadSessionByRecoveryToken } from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const destination = new URL(token ? "/guest" : "/", request.url);
  destination.search = "";

  if (!token) return NextResponse.redirect(destination);

  try {
    const session = await getLeadSessionByRecoveryToken(token);
    const response = NextResponse.redirect(destination, 303);
    response.cookies.set(GUEST_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expiresAt),
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?recovery=invalid", request.url), 303);
  }
}
