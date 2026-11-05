import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { RECOVERY_COOKIE } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

const emailOtpTypes = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

// Supports token-hash links that work across browsers, plus Supabase's PKCE code links.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const supabase = await createClient();
  let isRecovery = false;

  if (tokenHash) {
    const otpType = emailOtpTypes.find((allowedType) => allowedType === type);
    if (!/^[0-9a-f]{64}$/i.test(tokenHash) || !otpType) {
      return NextResponse.redirect(new URL("/sign-in?error=invalid", origin));
    }

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error) {
      console.error("Email token verification failed:", error.message);
      return NextResponse.redirect(new URL("/sign-in?error=link", origin));
    }

    isRecovery = otpType === "recovery";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Email link exchange failed:", error.message);
      return NextResponse.redirect(new URL("/sign-in?error=link", origin));
    }
  } else {
    return NextResponse.redirect(new URL("/sign-in?error=invalid", origin));
  }

  const cookieStore = await cookies();
  if (cookieStore.has(RECOVERY_COOKIE)) {
    isRecovery ||= !tokenHash;
    cookieStore.delete(RECOVERY_COOKIE);
  }

  if (isRecovery) {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
