"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { LeadSessionDto } from "@/src/types/lead-session";

export function CurrentLeadSession() {
  const [session, setSession] = useState<LeadSessionDto | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "missing" | "error"
  >("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/lead-sessions", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("lookup_failed");
        const payload = (await response.json()) as { session: LeadSessionDto };
        return payload.session;
      })
      .then((value) => {
        if (!active) return;
        setSession(value);
        setStatus(value ? "ready" : "missing");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return <p className="text-sm text-slate-600">Recovering your secure session…</p>;
  }

  if (status !== "ready" || !session) {
    return (
      <div className="space-y-4">
        <p className="text-slate-700">
          {status === "missing"
            ? "No active guest session was found."
            : "The session could not be loaded."}
        </p>
        <Link className="primary-button inline-flex" href="/">
          Return to entry page
        </Link>
      </div>
    );
  }

  const attribution = session.attribution;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-teal-50 p-5 text-teal-950">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
          Phase 1 verified
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          {session.openingStrategy?.headline ||
            "Your secure starting point is ready."}
        </h2>
        <p className="mt-2 text-sm leading-6 text-teal-800">
          {session.openingStrategy?.prompt ||
            "Attribution has been saved. Chat is intentionally not implemented yet."}
        </p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Clinic" value={session.clinic.name} />
        <Detail label="Session status" value={session.status} />
        <Detail label="Source channel" value={attribution.sourceChannel} />
        <Detail label="Identity level" value={attribution.identityLevel} />
        <Detail label="Campaign" value={attribution.campaignId || "—"} />
        <Detail label="Creative" value={attribution.creative || "—"} />
        <Detail
          label="Social platform"
          value={attribution.socialPlatform || "—"}
        />
        <Detail
          label="Landing timestamp"
          value={new Date(attribution.landingTimestamp).toLocaleString()}
        />
      </dl>

      <p className="rounded-xl border border-slate-200 px-4 py-3 text-xs leading-5 text-slate-500">
        The recovery credential is held in a Secure, HttpOnly cookie. Only its hash
        is stored in PostgreSQL. AI chat is outside Phase 1.
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
