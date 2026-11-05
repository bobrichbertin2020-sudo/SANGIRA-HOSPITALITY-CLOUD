import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE } from "@/lib/settings/options";

// Sends a recovery email. The flag cookie lets /auth/callback send the user to the
// password reset page after the one-time code is exchanged (PKCE needs the same browser).
export async function sendRecoveryEmail(email: string) {
  const supabase = await createClient();
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    base ? { redirectTo: `${base}/auth/callback` } : undefined,
  );
  if (error) {
    console.error("Password recovery email failed:", error.message);
    return false;
  }

  (await cookies()).set(RECOVERY_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  return true;
}
