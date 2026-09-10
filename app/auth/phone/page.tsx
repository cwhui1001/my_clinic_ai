import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PhoneAuthForm } from "@/app/components/phone-auth-form";
import { getLeadSessionByRecoveryToken } from "@/src/features/lead-sessions/service";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export default async function PhoneAuthPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.email_confirmed_at || data.user?.phone_confirmed_at) redirect("/consent");

  const token = (await cookies()).get(GUEST_SESSION_COOKIE)?.value;
  if (!token) redirect("/");
  try {
    await getLeadSessionByRecoveryToken(token);
  } catch {
    redirect("/");
  }

  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Verified phone</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Continue without email</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">We will send a one-time code through Supabase Auth. SMS delivery must be enabled for this hosted Supabase project.</p>
        <PhoneAuthForm />
        <Link className="mt-6 inline-block text-sm font-semibold text-slate-600 underline" href="/signup">Use email and password instead</Link>
      </section>
    </main>
  );
}
