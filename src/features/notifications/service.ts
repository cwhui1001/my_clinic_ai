import "server-only";

import * as webpush from "web-push";

import { getWebPushEnv } from "@/src/config/server-env";
import { pushSubscriptionSchema } from "@/src/features/notifications/schema";
import { buildResponseNotificationPayload } from "@/src/features/notifications/payload";
import { decryptProtectedContent, encryptProtectedContent, hashProtectedContent } from "@/src/server/crypto/protected-content";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export type NotificationDeliveryStatus = "delivered" | "failed" | "no_subscription" | "transport_unavailable";

export async function savePushSubscription(patientSessionId: string, subscription: unknown) {
  const parsed = pushSubscriptionSchema.parse(subscription);
  const supabase = await createSupabaseServerClient();
  const serialized = JSON.stringify(parsed);
  const { data, error } = await supabase.rpc("upsert_push_subscription", {
    p_patient_session_id: patientSessionId,
    p_subscription_ciphertext: encryptProtectedContent(serialized),
    p_endpoint_hash: hashProtectedContent(parsed.endpoint),
    p_expires_at: parsed.expirationTime ? new Date(parsed.expirationTime).toISOString() : null,
  });
  if (error || !data) throw new Error(error?.code === "P0020" ? "forbidden" : "database_error");
  return data;
}

export async function removePushSubscription(patientSessionId: string, endpoint: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("deactivate_push_subscription", {
    p_patient_session_id: patientSessionId,
    p_endpoint_hash: hashProtectedContent(endpoint),
  });
  if (error) throw new Error(error.code === "P0020" ? "forbidden" : "database_error");
  return data;
}

export async function deliverResponseNotification(clinicianResponseId: string): Promise<NotificationDeliveryStatus> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("notification_jobs")
    .select("*")
    .eq("clinician_response_id", clinicianResponseId)
    .single();
  if (jobError || !job) return "failed";
  if (job.status === "delivered") return "delivered";

  const pushEnv = getWebPushEnv();
  if (!pushEnv) {
    await recordUnavailable(job.id, job.attempt_count);
    return "transport_unavailable";
  }
  webpush.setVapidDetails(pushEnv.VAPID_SUBJECT, pushEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY, pushEnv.VAPID_PRIVATE_KEY);

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("*")
    .eq("patient_id", job.patient_id)
    .eq("active", true);
  if (error) return finishJob(job.id, "failed", "subscription_lookup_failed", job.attempt_count);
  if (!subscriptions?.length) return finishJob(job.id, "no_subscription", "no_subscription", job.attempt_count);

  let delivered = 0;
  let attempted = 0;
  for (const row of subscriptions) {
    attempted += 1;
    try {
      const subscription = pushSubscriptionSchema.parse(JSON.parse(decryptProtectedContent(row.subscription_ciphertext)));
      await webpush.sendNotification(subscription, JSON.stringify(buildResponseNotificationPayload(job.patient_session_id, job.escalation_id)), { TTL: 24 * 60 * 60, urgency: "normal", timeout: 10000, topic: `response-${clinicianResponseId.slice(0, 24)}` });
      delivered += 1;
      await admin.from("notification_attempts").insert({ notification_job_id: job.id, push_subscription_id: row.id, outcome: "delivered" });
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0, updated_at: new Date().toISOString() }).eq("id", row.id);
    } catch (reason) {
      const statusCode = getStatusCode(reason);
      const gone = statusCode === 404 || statusCode === 410;
      await admin.from("notification_attempts").insert({ notification_job_id: job.id, push_subscription_id: row.id, outcome: gone ? "gone" : "failed", provider_status: statusCode, error_code: gone ? "subscription_gone" : "push_failed" });
      await admin.from("push_subscriptions").update({ active: gone ? false : row.active, failure_count: row.failure_count + 1, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
  }
  return finishJob(job.id, delivered > 0 ? "delivered" : "failed", delivered > 0 ? null : "push_failed", job.attempt_count + attempted);
}

async function recordUnavailable(jobId: string, previousAttemptCount: number) {
  const admin = createAdminClient();
  await admin.from("notification_attempts").insert({ notification_job_id: jobId, outcome: "transport_unavailable", error_code: "transport_unavailable" });
  await finishJob(jobId, "transport_unavailable", "transport_unavailable", previousAttemptCount + 1);
}

async function finishJob(jobId: string, status: NotificationDeliveryStatus, errorCode: string | null, attemptCount: number): Promise<NotificationDeliveryStatus> {
  const admin = createAdminClient();
  await admin.from("notification_jobs").update({ status, attempt_count: attemptCount, delivered_at: status === "delivered" ? new Date().toISOString() : null, last_error_code: errorCode, updated_at: new Date().toISOString() }).eq("id", jobId);
  return status;
}

function getStatusCode(reason: unknown) {
  if (reason && typeof reason === "object" && "statusCode" in reason && typeof reason.statusCode === "number") return reason.statusCode;
  return null;
}
