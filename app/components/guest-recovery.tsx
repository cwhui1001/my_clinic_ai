"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RecoveryState = "checking" | "expired" | "purged" | "invalid";

export function GuestRecovery() {
  const [state, setState] = useState<RecoveryState>("checking");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", "/recover");
    if (!token) {
      queueMicrotask(() => setState("invalid"));
      return;
    }
    fetch("/api/lead-sessions/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => ({ ok: response.ok, payload: await response.json() as { state?: string; next?: string | null } }))
      .then(({ ok, payload }) => {
        if (ok && payload.state === "active" && payload.next) window.location.replace(payload.next);
        else setState(payload.state === "expired" || payload.state === "purged" ? payload.state : "invalid");
      }).catch(() => setState("invalid"));
  }, []);
  if (state === "checking") return <><h1 className="mt-4 text-3xl font-semibold text-slate-950">Checking your private link</h1><p className="mt-3 text-sm text-slate-600">The recovery credential is being exchanged and removed from the address bar.</p></>;
  const content = state === "expired"
    ? { title: "This guest session expired", body: "The recovery window ended, so this link cannot reopen the conversation. Scheduled retention cleanup removes abandoned guest messages; start a new conversation to continue." }
    : state === "purged"
      ? { title: "This guest session was purged", body: "Retention cleanup has completed. No guest conversation or contact content can be restored from this link." }
      : { title: "This recovery link is not valid", body: "It may have already been used, was changed, or never belonged to an active guest session. No patient data was opened." };
  return <><h1 className="mt-4 text-3xl font-semibold text-slate-950">{content.title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{content.body}</p><Link className="primary-button mt-6 inline-flex" href="/">Start a new guest conversation</Link></>;
}
