"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PhoneAuthForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPhone = String(form.get("phone") || phone);
    setPending(true);
    setError(null);
    try {
      const response = await fetch(codeSent ? "/api/auth/phone/verify" : "/api/auth/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(codeSent ? { phone: nextPhone, token: String(form.get("token") || "") } : { phone: nextPhone }),
      });
      const payload = await response.json() as { next?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "phone_auth_failed");
      if (payload.next) {
        router.replace(payload.next);
        router.refresh();
      } else {
        setPhone(nextPhone);
        setCodeSent(true);
      }
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "phone_auth_failed";
      setError(code === "invalid_code" ? "That code was not accepted or has expired." : "Phone verification could not be completed. Check the number and SMS configuration, then try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <div>
        <label className="field-label" htmlFor="phone">Mobile phone</label>
        <input className="field-control" id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+60 12 345 6789" value={phone} onChange={(event) => setPhone(event.target.value)} readOnly={codeSent} required />
      </div>
      {codeSent ? (
        <div>
          <label className="field-label" htmlFor="token">Six-digit code</label>
          <input className="field-control" id="token" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Please wait..." : codeSent ? "Verify and continue" : "Send verification code"}</button>
    </form>
  );
}
