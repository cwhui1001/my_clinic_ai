import { NextRequest, NextResponse } from "next/server";

import { patientMessageRequestSchema } from "@/src/features/patient-chat/schema";
import { createPatientTurn, PatientChatError } from "@/src/features/patient-chat/service";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  if (!UUID_PATTERN.test(sessionId)) return errorResponse(new PatientChatError("not_found"));

  const body = await readJsonBody(request);
  if (!body.success) {
    return NextResponse.json(
      { error: body.error },
      { status: body.status, headers: NO_STORE_HEADERS },
    );
  }
  const parsed = patientMessageRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const reply = await createPatientTurn(sessionId, parsed.data);
    return NextResponse.json({ reply }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    writeAuditLog({
      action: "patient_message.complete",
      outcome: "failure",
      errorCode: error instanceof PatientChatError ? error.code : "unexpected_error",
    });
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PatientChatError) {
    const status =
      error.code === "unauthenticated"
        ? 401
        : error.code === "not_found"
          ? 404
          : error.code === "consent_required"
            ? 403
            : error.code === "rate_limited"
              ? 429
              : error.code === "turn_in_progress" || error.code === "invalid_state"
                ? 409
                : 503;
    return NextResponse.json({ error: error.code }, { status, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(
    { error: "unexpected_error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
