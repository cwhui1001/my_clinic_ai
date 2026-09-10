import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { MARKETING_CONSENT_NOTICE_VERSION, MARKETING_CONSENT_POLICY_VERSION } from "@/src/features/consent/constants";
import { marketingConsentRequestSchema } from "@/src/features/consent/schema";
import { AuthenticationError, getVerifiedUser } from "@/src/server/auth/user";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };
const requestSchema = marketingConsentRequestSchema.extend({ patientSessionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    await getVerifiedUser();
    const body = await readJsonBody(request);
    const parsed = body.success ? requestSchema.safeParse(body.data) : null;
    if (!parsed?.success || parsed.data.policyVersion !== MARKETING_CONSENT_POLICY_VERSION || parsed.data.noticeVersion !== MARKETING_CONSENT_NOTICE_VERSION) {
      return NextResponse.json({ error: "invalid_consent" }, { status: 400, headers: HEADERS });
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("record_marketing_email_consent", {
      p_patient_session_id: parsed.data.patientSessionId,
      p_action: parsed.data.action,
      p_policy_version: parsed.data.policyVersion,
      p_notice_version: parsed.data.noticeVersion,
      p_idempotency_key: `marketing_email:${parsed.data.action}:${parsed.data.patientSessionId}:${randomUUID()}`,
    });
    if (error || !data) return NextResponse.json({ error: "consent_failed" }, { status: error?.code === "P0020" ? 403 : 503, headers: HEADERS });
    writeAuditLog({ action: "consent.marketing_email", outcome: "success", resourceId: data });
    return NextResponse.json({ consentEventId: data }, { status: 201, headers: HEADERS });
  } catch (error) {
    const status = error instanceof AuthenticationError ? 401 : 503;
    writeAuditLog({ action: "consent.marketing_email", outcome: "failure", errorCode: "consent_failed" });
    return NextResponse.json({ error: status === 401 ? "unauthenticated" : "consent_failed" }, { status, headers: HEADERS });
  }
}
