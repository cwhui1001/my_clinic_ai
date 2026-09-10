"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import {
  HEALTHCARE_CONSENT_NOTICE_VERSION,
  HEALTHCARE_CONSENT_POLICY_VERSION,
  MARKETING_CONSENT_NOTICE_VERSION,
  MARKETING_CONSENT_POLICY_VERSION,
} from "@/src/features/consent/constants";

export function ConsentForm({ clinicName, initialPhone }: { clinicName: string; initialPhone: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("healthcareConsent") !== "on") {
      setError("Consent is required to share the guest conversation with the clinic.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: String(form.get("phone") || ""),
          healthcareConsent: true,
          policyVersion: HEALTHCARE_CONSENT_POLICY_VERSION,
          noticeVersion: HEALTHCARE_CONSENT_NOTICE_VERSION,
          marketingConsent: form.get("marketingConsent") === "on",
          marketingPolicyVersion: MARKETING_CONSENT_POLICY_VERSION,
          marketingNoticeVersion: MARKETING_CONSENT_NOTICE_VERSION,
        }),
      });
      const payload = (await response.json()) as { next?: string; error?: string };
      if (!response.ok || !payload.next) throw new Error(payload.error || "conversion_failed");
      router.replace(payload.next);
      router.refresh();
    } catch (reason) {
      setError(conversionError(reason instanceof Error ? reason.message : "conversion_failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-5">
      <div>
        <label className="field-label" htmlFor="phone">Mobile phone</label>
        <input className="field-control" id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={initialPhone} required />
        <p className="mt-1.5 text-xs leading-5 text-slate-500">Used by {clinicName} for care-related follow-up. It is encrypted at rest.</p>
      </div>

      <label className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <input className="mt-1 h-4 w-4 accent-teal-700" name="healthcareConsent" type="checkbox" required />
        <span className="text-sm leading-6 text-slate-700">
          I consent to Nightingale sharing my guest conversation, its acquisition source, and my verified contact details with {clinicName} for healthcare follow-up. I understand this creates a patient session and that I can later withdraw consent for future use.
        </span>
      </label>

      <p className="text-xs leading-5 text-slate-500">Clinical consent record: {HEALTHCARE_CONSENT_NOTICE_VERSION}.</p>

      <label className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <input className="mt-1 h-4 w-4 accent-teal-700" name="marketingConsent" type="checkbox" />
        <span className="text-sm leading-6 text-slate-700">
          Optional: I agree to receive clinic news and service updates by email. This is not required for care and is off unless I select it.
        </span>
      </label>
      <p className="text-xs leading-5 text-slate-500">Marketing consent record: {MARKETING_CONSENT_NOTICE_VERSION}. You can withdraw this separately without affecting clinical communication.</p>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Creating secure patient session..." : "Consent and continue securely"}</button>
    </form>
  );
}

function conversionError(code: string) {
  if (code === "value_required") return "Continue the guest chat until it provides a useful response before converting.";
  if (code === "identity_unverified") return "Verify your email or mobile number before providing consent.";
  if (code === "invalid_phone") return "Enter a valid phone number with 8 to 15 digits.";
  if (code === "guest_session_required") return "The guest session is missing or expired.";
  if (code === "conversion_conflict") return "This guest session cannot be linked to the signed-in account.";
  return "The secure patient session could not be created. Please try again.";
}
