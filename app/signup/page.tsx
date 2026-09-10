import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthForm } from "@/app/components/auth-form";
import { getLeadSessionByRecoveryToken } from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.email_confirmed_at || data.user?.phone_confirmed_at) redirect("/consent");

  const cookieStore = await cookies();
  const token = cookieStore.get(GUEST_SESSION_COOKIE)?.value;
  if (!token) return <MissingGuestSession />;

  let clinicName: string;
  try {
    clinicName = (await getLeadSessionByRecoveryToken(token)).clinic.name;
  } catch {
    return <MissingGuestSession />;
  }

  const query = await searchParams;
  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Secure continuation</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Continue with {clinicName}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Verify your identity before deciding whether to share your guest conversation with the clinic.</p>
        <div className="mt-7"><AuthForm clinicName={clinicName} initialMode={query.mode === "login" ? "login" : "signup"} /></div>
      </section>
    </main>
  );
}

function MissingGuestSession() {
  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Guest session required</p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">Start from the clinic entry page</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Authentication must be linked to an active guest conversation so its source and context can be preserved safely.</p>
        <Link className="primary-button mt-6 inline-flex" href="/">Start a guest session</Link>
      </section>
    </main>
  );
}
