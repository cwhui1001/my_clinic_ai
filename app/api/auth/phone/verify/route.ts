import { NextRequest, NextResponse } from "next/server";

import { phoneOtpVerifySchema } from "@/src/features/auth/schema";
import { PENDING_PHONE_COOKIE } from "@/src/features/consent/constants";
import { normalizePhone } from "@/src/features/consent/schema";
import { decryptProtectedContent } from "@/src/server/crypto/protected-content";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  try {
    const pending = request.cookies.get(PENDING_PHONE_COOKIE)?.value;
    const body = await readJsonBody(request);
    const parsed = body.success ? phoneOtpVerifySchema.safeParse(body.data) : null;
    const phone = parsed?.success ? normalizePhone(parsed.data.phone) : null;
    if (!parsed?.success || !pending || !phone || decryptProtectedContent(pending) !== phone) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400, headers: HEADERS });
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ phone, token: parsed.data.token, type: "sms" });
    if (error || !data.user?.phone_confirmed_at) return NextResponse.json({ error: "invalid_code" }, { status: 401, headers: HEADERS });
    writeAuditLog({ action: "auth.phone_otp.verify", outcome: "success", resourceId: data.user.id });
    const response = NextResponse.json({ next: "/consent" }, { headers: HEADERS });
    response.cookies.set(PENDING_PHONE_COOKIE, pending, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 });
    return response;
  } catch {
    writeAuditLog({ action: "auth.phone_otp.verify", outcome: "failure", errorCode: "phone_auth_failed" });
    return NextResponse.json({ error: "phone_auth_failed" }, { status: 503, headers: HEADERS });
  }
}
