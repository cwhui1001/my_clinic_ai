import { NextRequest, NextResponse } from "next/server";

import { phoneOtpStartSchema } from "@/src/features/auth/schema";
import { PENDING_PHONE_COOKIE } from "@/src/features/consent/constants";
import { normalizePhone } from "@/src/features/consent/schema";
import { getLeadSessionByRecoveryToken, markLeadAuthStarted } from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { encryptProtectedContent } from "@/src/server/crypto/protected-content";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) return NextResponse.json({ error: "guest_session_required" }, { status: 404, headers: HEADERS });
  try {
    await getLeadSessionByRecoveryToken(recoveryToken);
    const body = await readJsonBody(request);
    const parsed = body.success ? phoneOtpStartSchema.safeParse(body.data) : null;
    const phone = parsed?.success ? normalizePhone(parsed.data.phone) : null;
    if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400, headers: HEADERS });

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
    if (error) return NextResponse.json({ error: "phone_auth_failed" }, { status: 400, headers: HEADERS });
    await markLeadAuthStarted(recoveryToken);
    writeAuditLog({ action: "auth.phone_otp.start", outcome: "success" });
    const response = NextResponse.json({ sent: true }, { headers: HEADERS });
    response.cookies.set(PENDING_PHONE_COOKIE, encryptProtectedContent(phone), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 10 * 60 });
    return response;
  } catch {
    writeAuditLog({ action: "auth.phone_otp.start", outcome: "failure", errorCode: "phone_auth_failed" });
    return NextResponse.json({ error: "phone_auth_failed" }, { status: 503, headers: HEADERS });
  }
}
