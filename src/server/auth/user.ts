import "server-only";

import { createSupabaseServerClient } from "@/src/server/supabase/server";

export class AuthenticationError extends Error {
  constructor(public readonly code: "unauthenticated" | "identity_unverified") {
    super(code);
  }
}

export async function getVerifiedUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthenticationError("unauthenticated");
  if (!data.user.email_confirmed_at && !data.user.phone_confirmed_at) {
    throw new AuthenticationError("identity_unverified");
  }
  return data.user;
}
