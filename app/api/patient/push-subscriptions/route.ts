import { NextRequest, NextResponse } from "next/server";

import { pushSubscriptionRequestSchema, pushUnsubscribeRequestSchema } from "@/src/features/notifications/schema";
import { removePushSubscription, savePushSubscription } from "@/src/features/notifications/service";
import { readJsonBody } from "@/src/server/http/read-json";
import { writeAuditLog } from "@/src/server/logging/audit";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const parsed = body.success ? pushSubscriptionRequestSchema.safeParse(body.data) : null;
  if (!parsed?.success) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: HEADERS });
  try {
    const id = await savePushSubscription(parsed.data.patientSessionId, parsed.data.subscription);
    writeAuditLog({ action: "push_subscription.save", outcome: "success", resourceId: id });
    return NextResponse.json({ subscriptionId: id }, { status: 201, headers: HEADERS });
  } catch (error) {
    const status = error instanceof Error && error.message === "forbidden" ? 403 : 503;
    return NextResponse.json({ error: status === 403 ? "forbidden" : "subscription_failed" }, { status, headers: HEADERS });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await readJsonBody(request);
  const parsed = body.success ? pushUnsubscribeRequestSchema.safeParse(body.data) : null;
  if (!parsed?.success) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: HEADERS });
  try {
    await removePushSubscription(parsed.data.patientSessionId, parsed.data.endpoint);
    return NextResponse.json({ removed: true }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "subscription_failed" }, { status: 503, headers: HEADERS });
  }
}
