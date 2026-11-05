import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { RECOVERY_COOKIE } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

// Completes Supabase email links (confirmation, email change, recovery) by exchanging the
// one-time code for a session.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Email link exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/sign-in?error=link`);
  }

  const cookieStore = await cookies();
  if (cookieStore.get(RECOVERY_COOKIE)) {
    cookieStore.delete(RECOVERY_COOKIE);
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
