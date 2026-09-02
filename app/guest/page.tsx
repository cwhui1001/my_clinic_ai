import { GuestChat } from "@/app/components/guest-chat";

export default function GuestPage() {
  return (
    <main className="page-shell">
      <section className="w-full max-w-4xl">
        <p className="eyebrow">Nightingale · Guest chat</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          Ask a question before signing up
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Get useful information while remaining a guest. Personal clinical concerns
          are summarized without diagnosis, and clinic staff cannot see protected
          messages before consent.
        </p>
        <div className="mt-8">
          <GuestChat />
        </div>
      </section>
    </main>
  );
}
