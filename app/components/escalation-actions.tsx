"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function EscalationActions({ escalationId, status, canRespond }: { escalationId: string; status: string; canRespond: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);

  async function acknowledge() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/staff/escalations/${escalationId}/acknowledge`, { method: "POST" });
    if (!response.ok) setError("The escalation could not be acknowledged.");
    else router.refresh();
    setPending(false);
  }

  async function respond(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDelivery(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/staff/escalations/${escalationId}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: String(form.get("content") || "") }),
    });
    const payload = await response.json() as { notificationStatus?: string };
    if (!response.ok) setError("The protected response could not be recorded.");
    else {
      event.currentTarget.reset();
      setDelivery(notificationMessage(payload.notificationStatus));
      router.refresh();
    }
    setPending(false);
  }

  async function close() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/staff/escalations/${escalationId}/close`, { method: "POST" });
    if (!response.ok) setError("The escalation could not be closed.");
    else router.refresh();
    setPending(false);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-950">Care-team action</h2>
      {status === "queued" ? <button className="mt-4 rounded-xl border border-teal-700 px-4 py-2 text-sm font-bold text-teal-800 hover:bg-teal-50" disabled={pending} onClick={acknowledge} type="button">Acknowledge review</button> : null}
      {status === "responded" && canRespond ? <button className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" disabled={pending} onClick={close} type="button">Close escalation</button> : null}
      {canRespond ? (
        <form className="mt-5" onSubmit={respond}>
          <label className="field-label" htmlFor="clinician-response">Protected clinician response</label>
          <textarea className="field-control min-h-28" id="clinician-response" maxLength={2000} name="content" required />
          <p className="mt-2 text-xs text-slate-500">Stored encrypted with your membership as authorship provenance.</p>
          <button className="primary-button mt-4" disabled={pending} type="submit">{pending ? "Saving..." : "Record response"}</button>
        </form>
      ) : <p className="mt-3 text-sm text-slate-600">Staff may review and acknowledge. A Nurse or Clinician role is required to record a clinical response.</p>}
      {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
      {delivery ? <p className="mt-3 text-sm text-slate-600" role="status">{delivery}</p> : null}
    </section>
  );
}

function notificationMessage(status?: string) {
  if (status === "delivered") return "Response recorded. A PHI-free device alert was delivered to at least one subscribed device.";
  if (status === "no_subscription") return "Response recorded. The patient has no subscribed device, so no alert was sent.";
  if (status === "transport_unavailable") return "Response recorded. Device-alert transport is not configured, so no alert was sent.";
  return "Response recorded. Device-alert delivery failed; the response remains available in the secure conversation.";
}
