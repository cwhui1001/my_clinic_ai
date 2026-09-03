import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ConsentForm } from "@/app/components/consent-form";
import { PENDING_PHONE_COOKIE } from "@/src/features/consent/constants";
import { getLeadSessionByRecoveryToken } from "@/src/features/lead-sessions/service";
import { AuthenticationError, getVerifiedUser } from "@/src/server/auth/user";
import { GUEST_SESSION_COOKIE } from "@/src/server/crypto/guest-token";
import { decryptProtectedContent } from "@/src/server/crypto/protected-content";

export default async function ConsentPage() {
  let user;
  try {
    user = await getVerifiedUser();
  } catch (error) {
    if (error instanceof AuthenticationError && error.code === "email_unverified") redirect("/auth/check-email");
    redirect("/signup?mode=login");
  }

  const cookieStore = await cookies();
  const recoveryToken = cookieStore.get(GUEST_SESSION_COOKIE)?.value;
  if (!recoveryToken) return <MissingGuestSession />;

  let clinicName: string;
  try {
    clinicName = (await getLeadSessionByRecoveryToken(recoveryToken)).clinic.name;
  } catch {
    return <MissingGuestSession />;
  }

  let initialPhone = "";
  const encryptedPhone = cookieStore.get(PENDING_PHONE_COOKIE)?.value;
  if (encryptedPhone) {
    try {
      initialPhone = decryptProtectedContent(encryptedPhone);
    } catch {
      initialPhone = "";
    }
  }

  return (
    <main className="page-shell">
      <section className="surface max-w-2xl">
        <p className="eyebrow">Explicit consent</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Choose whether to continue as a patient</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Your email <strong className="text-slate-800">{user.email}</strong> is verified. Nothing from the guest conversation is visible to {clinicName} until you actively consent below.
        </p>
        <div className="mt-5 rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm leading-6 text-teal-950">
          If you consent, Nightingale will preserve the conversation and its original source, create a patient session linked to your verified account, and make that context available for healthcare follow-up. This is not marketing consent.
        </div>
        <ConsentForm clinicName={clinicName} initialPhone={initialPhone} />
        <Link className="mt-6 inline-block text-sm font-semibold text-slate-600 underline" href="/guest">Not now — return to guest chat</Link>
      </section>
    </main>
  );
}

function MissingGuestSession() {
  return (
    <main className="page-shell">
      <section className="surface max-w-lg">
        <p className="eyebrow">Guest session required</p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">There is no guest session to convert</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Start a new guest conversation or recover the original one before reviewing consent.</p>
        <Link className="primary-button mt-6 inline-flex" href="/">Start a guest session</Link>
      </section>
    </main>
  );
}
