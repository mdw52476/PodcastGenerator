import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Sign-in links from the Supabase email template point here with a token hash.
// Unlike /auth/callback, this works whichever browser opens the email link.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = (request.nextUrl.searchParams.get("type") ?? "email") as EmailOtpType;
  if (tokenHash) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "That sign-in link expired or was already used. Each link works once; request a new one.");
  return NextResponse.redirect(url);
}
