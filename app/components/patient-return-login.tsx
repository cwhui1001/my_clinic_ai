"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PatientReturnLogin({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/patient-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") || ""),
          password: String(form.get("password") || ""),
          next,
        }),
      });
      const payload = (await response.json()) as { next?: string };
      if (!response.ok || !payload.next) throw new Error("login_failed");
      router.replace(payload.next);
      router.refresh();
    } catch {
      setError("The email or password was not accepted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={submit}>
      <div>
        <label className="field-label" htmlFor="return-email">Email address</label>
        <input className="field-control" id="return-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="field-label" htmlFor="return-password">Password</label>
        <input className="field-control" id="return-password" name="password" type="password" autoComplete="current-password" minLength={8} required />
      </div>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in and open conversation"}
      </button>
    </form>
  );
}
