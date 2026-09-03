"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function StaffLoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/staff/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") || ""), password: String(form.get("password") || "") }),
      });
      const payload = (await response.json()) as { next?: string; error?: string };
      if (!response.ok || !payload.next) throw new Error(payload.error || "login_failed");
      router.replace(payload.next);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "staff_access_denied"
        ? "This account does not have an active clinic role."
        : "The email or password was not accepted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <div><label className="field-label" htmlFor="staff-email">Work email</label><input className="field-control" id="staff-email" name="email" type="email" autoComplete="email" required /></div>
      <div><label className="field-label" htmlFor="staff-password">Password</label><input className="field-control" id="staff-password" name="password" type="password" autoComplete="current-password" minLength={8} required /></div>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={pending} type="submit">{pending ? "Signing in..." : "Open clinic dashboard"}</button>
    </form>
  );
}
