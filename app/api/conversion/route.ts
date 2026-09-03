import { NextRequest, NextResponse } from "next/server";

import {
  HEALTHCARE_CONSENT_NOTICE_VERSION,
  HEALTHCARE_CONSENT_POLICY_VERSION,
  PENDING_PHONE_COOKIE,
} from "@/src/features/consent/constants";
import { conversionRequestSchema, normalizePhone } from "@/src/features/consent/schema";
import { bootstrapGuestMemory } from "@/src/features/memory/service";
import { AuthenticationError, getVerifiedUser } from "@/src/server/auth/user";
import { GUEST_SESSION_COOKIE, hashGuestToken } from "@/src/server/crypto/guest-token";
import { encryptProtectedContent, hashProtectedContent } from "@/src/server/crypto/protected-content";
import { writeAuditLog } from "@/src/server/logging/audit";
import { readJsonBody } from "@/src/server/http/read-json";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const recoveryToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) return jsonError("guest_session_required", 404);

  try {
    const user = await getVerifiedUser();
    const body = await readJsonBody(request);
    if (!body.success) return jsonError(body.error, body.status);
    const parsed = conversionRequestSchema.safeParse(body.data);
    const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
    if (
      !parsed.success ||
      !phone ||
      parsed.data.policyVersion !== HEALTHCARE_CONSENT_POLICY_VERSION ||
      parsed.data.noticeVersion !== HEALTHCARE_CONSENT_NOTICE_VERSION
    ) {
      return jsonError("invalid_consent", 400);
    }

    const supabase = await createSupabaseServerClient();
    const { data: patientSessionId, error } = await supabase.rpc(
      "convert_lead_to_patient",
      {
        p_recovery_token_hash: hashGuestToken(recoveryToken),
        p_phone_ciphertext: encryptProtectedContent(phone),
        p_phone_hash: hashProtectedContent(phone),
        p_consent_granted: parsed.data.healthcareConsent,
        p_policy_version: parsed.data.policyVersion,
        p_notice_version: parsed.data.noticeVersion,
      },
    );

    if (error || !patientSessionId) {
      const mapped = mapConversionError(error?.code);
      writeAuditLog({ action: "lead.convert", outcome: "failure", resourceId: user.id, errorCode: mapped.code });
      return jsonError(mapped.code, mapped.status);
    }

    await bootstrapGuestMemory(patientSessionId);

    writeAuditLog({ action: "lead.convert", outcome: "success", resourceId: patientSessionId });
    const response = NextResponse.json(
      { patientSessionId, next: `/patient/sessions/${patientSessionId}` },
      { headers: NO_STORE_HEADERS },
    );
    response.cookies.delete(GUEST_SESSION_COOKIE);
    response.cookies.delete(PENDING_PHONE_COOKIE);
    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return jsonError(error.code, error.code === "email_unverified" ? 403 : 401);
    }
    writeAuditLog({ action: "lead.convert", outcome: "failure", errorCode: "conversion_failed" });
    return jsonError("conversion_failed", 503);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE_HEADERS });
}

function mapConversionError(code?: string) {
  if (code === "P0003") return { code: "guest_session_required", status: 404 };
  if (code === "P0010") return { code: "unauthenticated", status: 401 };
  if (code === "P0011") return { code: "email_unverified", status: 403 };
  if (code === "P0012") return { code: "invalid_consent", status: 400 };
  if (code === "P0013") return { code: "invalid_phone", status: 400 };
  if (code === "P0014") return { code: "value_required", status: 409 };
  if (code === "42501") return { code: "conversion_conflict", status: 409 };
  return { code: "conversion_failed", status: 503 };
}
