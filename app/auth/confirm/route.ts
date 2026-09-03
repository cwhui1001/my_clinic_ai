import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/src/server/supabase/server";

const ALLOWED_TYPES = new Set<EmailOtpType>(["email", "signup"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && requestedType && ALLOWED_TYPES.has(requestedType)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: requestedType,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL("/consent", request.url));
  }

  return NextResponse.redirect(new URL("/signup?mode=login&error=verification", request.url));
}
