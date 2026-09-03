"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type AuthMode = "signup" | "login";

export function AuthForm({
  clinicName,
  initialMode = "signup",
}: {
  clinicName: string;
  initialMode?: AuthMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (mode === "signup" && password !== String(form.get("confirmPassword") || "")) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const body =
        mode === "signup"
          ? {
              email: String(form.get("email") || ""),
              phone: String(form.get("phone") || ""),
              password,
            }
          : { email: String(form.get("email") || ""), password };
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { next?: string; error?: string };
      if (!response.ok || !payload.next) throw new Error(payload.error || "auth_failed");
      router.push(payload.next);
      router.refresh();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "auth_failed";
      setError(authError(code, mode));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex rounded-xl bg-slate-100 p-1" aria-label="Authentication mode">
        {(["signup", "login"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              mode === value ? "bg-white text-teal-800 shadow-sm" : "text-slate-600"
            }`}
          >
            {value === "signup" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="email">Email address</label>
          <input className="field-control" id="email" name="email" type="email" autoComplete="email" required />
        </div>

        {mode === "signup" ? (
          <div>
            <label className="field-label" htmlFor="phone">Mobile phone</label>
            <input
              className="field-control"
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+60 12 345 6789"
              required
            />
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              Stored encrypted and shared with {clinicName} only after you consent.
            </p>
          </div>
        ) : null}

        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input className="field-control" id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required />
          {mode === "signup" ? <p className="mt-1.5 text-xs text-slate-500">Use at least 8 characters, including a letter and a number.</p> : null}
        </div>

        {mode === "signup" ? (
          <div>
            <label className="field-label" htmlFor="confirmPassword">Confirm password</label>
            <input className="field-control" id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required />
          </div>
        ) : null}

        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Please wait..." : mode === "signup" ? "Create secure account" : "Sign in securely"}
        </button>
      </form>

      <p className="mt-6 text-xs leading-5 text-slate-500">
        Your guest conversation remains private until email verification and explicit consent are complete. <Link className="font-semibold text-teal-700 underline" href="/guest">Return to guest chat</Link>
      </p>
    </div>
  );
}

function authError(code: string, mode: AuthMode) {
  if (code === "guest_session_required" || code === "not_found") return "Your guest session is missing or expired. Return to the entry page to start again.";
  if (code === "invalid_credentials") return mode === "signup" ? "Enter a valid email, phone number, and password." : "Enter a valid email and password.";
  if (mode === "login") return "The email or password was not accepted.";
  return "The account could not be created. It may already exist; try signing in instead.";
}
