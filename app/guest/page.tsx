import { CurrentLeadSession } from "@/app/components/current-lead-session";

export default function GuestPage() {
  return (
    <main className="page-shell">
      <section className="surface max-w-3xl">
        <p className="eyebrow">Nightingale · Guest session</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          Your context is ready
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          This screen proves LeadSession creation, secure recovery, channel
          attribution, and declarative opening selection. Patient intake and AI chat
          are not part of this phase.
        </p>
        <div className="mt-8">
          <CurrentLeadSession />
        </div>
      </section>
    </main>
  );
}
