"use server";

import { redirect } from "next/navigation";
import { sendRecoveryEmail } from "@/lib/auth/recovery";
import { emailPattern } from "@/lib/settings/options";
import { passwordMeetsRules } from "@/lib/settings/password";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) {
    redirect("/forgot-password?error=invalid");
  }

  // The same response is shown whether or not the account exists.
  await sendRecoveryEmail(email);
  redirect("/forgot-password?sent=1");
}

export async function resetPassword(formData: FormData) {
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (!passwordMeetsRules(next) || next !== confirm) {
    redirect("/reset-password?error=invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in?error=link");
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    console.error("Password reset failed:", error.message);
    redirect("/reset-password?error=failed");
  }

  await supabase.auth.signOut({ scope: "others" });
  redirect("/dashboard?notice=password-updated");
}
