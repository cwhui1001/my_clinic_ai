import { NextResponse } from "next/server";

import { PENDING_PHONE_COOKIE } from "@/src/features/consent/constants";
import { createSupabaseServerClient } from "@/src/server/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const response = NextResponse.json(
    { next: "/" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  response.cookies.delete(PENDING_PHONE_COOKIE);
  return response;
}
