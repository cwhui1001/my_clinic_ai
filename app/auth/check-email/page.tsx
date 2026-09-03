import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Verify your identity</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Check your email</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Open the verification message from Nightingale. After verification, you will review the consent notice before anything is shared with the clinic.
        </p>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          Keep this browser open so your verified account can remain linked to the guest session.
        </p>
        <Link className="mt-6 inline-block text-sm font-semibold text-teal-700 underline" href="/signup?mode=login">Already verified? Sign in</Link>
      </section>
    </main>
  );
}
