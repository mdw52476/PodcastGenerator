import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// The emailed link lands here with a one-time code; swap it for a session.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("error", "That sign-in link expired or was already used. Request a new one.");
  return NextResponse.redirect(url);
}
