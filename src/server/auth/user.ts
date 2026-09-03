import "server-only";

import { createSupabaseServerClient } from "@/src/server/supabase/server";

export class AuthenticationError extends Error {
  constructor(public readonly code: "unauthenticated" | "email_unverified") {
    super(code);
  }
}

export async function getVerifiedUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthenticationError("unauthenticated");
  if (!data.user.email || !data.user.email_confirmed_at) {
    throw new AuthenticationError("email_unverified");
  }
  return data.user;
}
