import { NextRequest, NextResponse } from "next/server";

import { signupCredentialsSchema } from "@/src/features/auth/schema";
import { PENDING_PHONE_COOKIE } from "@/src/features/consent/constants";
import { normalizePhone } from "@/src/features/consent/schema";
import {
  getLeadSessionByRecoveryToken,
  markLeadAuthStarted,
} from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { encryptProtectedContent } from "@/src/server/crypto/protected-content";
import { writeAuditLog } from "@/src/server/logging/audit";
import { readJsonBody } from "@/src/server/http/read-json";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) {
    return NextResponse.json({ error: "guest_session_required" }, { status: 404 });
  }

  try {
    await getLeadSessionByRecoveryToken(recoveryToken);
    const body = await readJsonBody(request);
    if (!body.success) {
      return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
    }
    const parsed = signupCredentialsSchema.safeParse(body.data);
    const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
    if (!parsed.success || !phone) {
      return NextResponse.json(
        { error: "invalid_credentials" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback?next=/consent`,
      },
    });
    if (error || !data.user) {
      return NextResponse.json(
        { error: "signup_failed" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    await markLeadAuthStarted(recoveryToken);
    writeAuditLog({
      action: "auth.signup",
      outcome: "success",
      resourceId: data.user.id,
    });
    const response = NextResponse.json(
      { next: data.session ? "/consent" : "/auth/check-email" },
      { status: 201, headers: NO_STORE_HEADERS },
    );
    response.cookies.set(PENDING_PHONE_COOKIE, encryptProtectedContent(phone), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });
    return response;
  } catch {
    writeAuditLog({ action: "auth.signup", outcome: "failure", errorCode: "signup_failed" });
    return NextResponse.json(
      { error: "signup_failed" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
