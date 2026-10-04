import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Fallback for links that arrive with a one-time code (Supabase's default email
// template). This only works in the same browser that requested the link;
// /auth/confirm (token hash) works in any browser.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  let message = "That sign-in link expired or was already used. Each link works once; request a new one.";
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", request.url));
    if (/code verifier/i.test(error.message))
      message = "The link opened in a different browser from the one you used to request it. Request a new link and open it in this browser.";
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}
