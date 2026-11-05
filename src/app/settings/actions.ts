"use server";

import { randomUUID } from "node:crypto";
import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { detectFileType } from "@/lib/documents/files";
import { sendRecoveryEmail } from "@/lib/auth/recovery";
import { LANG_COOKIE } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import {
  MAX_AVATAR_BYTES,
  THEME_COOKIE,
  emailPattern,
  languages,
  phonePattern,
  themes,
  usernamePattern,
} from "@/lib/settings/options";
import { passwordMeetsRules } from "@/lib/settings/password";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type SettingsState = { error?: string; success?: string };

const AVATAR_BUCKET = "sangira-avatars";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/sign-in");
  }
  return { supabase, user };
}

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function updateProfile(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { supabase, user } = await requireUser();
  const firstName = text(formData, "firstName");
  const lastName = text(formData, "lastName");
  const username = text(formData, "username").toLowerCase();
  const phone = text(formData, "phone");
  const address = text(formData, "address");
  const language = text(formData, "language");
  const email = text(formData, "email").toLowerCase();

  if (
    !firstName || firstName.length > 80 ||
    !lastName || lastName.length > 80 ||
    (username && !usernamePattern.test(username)) ||
    (phone && !phonePattern.test(phone)) ||
    address.length > 240 ||
    !languages.some((item) => item.value === language) ||
    !emailPattern.test(email) || email.length > 254
  ) {
    return {
      error:
        "Check your details: names are required, the username uses 3-30 lowercase letters, numbers, dots or underscores, and the phone number and email must be valid.",
    };
  }

  const { error } = await supabase.rpc("update_my_profile", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_username: username,
    p_phone: phone,
    p_address: address,
    p_language: language,
  });
  if (error) {
    console.error("Profile update failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "That username is already taken."
          : "Your profile could not be saved. Please try again.",
    };
  }

  const emailChanged = email !== (user.email ?? "").toLowerCase();
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  const { error: authError } = await supabase.auth.updateUser(
    { ...(emailChanged ? { email } : {}), data: { full_name: `${firstName} ${lastName}` } },
    emailChanged && base ? { emailRedirectTo: `${base}/auth/callback` } : undefined,
  );
  if (authError) {
    console.error("Auth profile update failed:", authError.message);
    return {
      error: emailChanged
        ? "Your details were saved, but the email address could not be changed. It may already be in use."
        : "Your details were saved, but your account name could not be synced.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  (await cookies()).set(LANG_COOKIE, language, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  return {
    success: emailChanged
      ? (await getT()).t(
          "Profile saved. We sent a confirmation link to {email}; your sign-in email changes after you confirm it.",
          { email },
        )
      : "Profile saved.",
  };
}

export async function uploadAvatar(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { supabase, user } = await requireUser();
  const file = formData.get("photo");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo to upload." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: "The photo must be 2 MB or smaller." };
  }

  const detected = detectFileType(new Uint8Array(await file.arrayBuffer()).subarray(0, 16));
  if (!detected || detected.mime === "application/pdf") {
    return { error: "Use a JPEG, PNG or WebP image." };
  }

  const path = `${user.id}/${randomUUID()}.${detected.ext}`;
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: detected.mime, upsert: false });
  if (uploadError) {
    console.error("Avatar upload failed:", uploadError.message);
    return { error: "The photo could not be uploaded. Please try again." };
  }

  const { data: oldPath, error } = await supabase.rpc("set_my_avatar", { p_path: path });
  if (error) {
    console.error("Avatar save failed:", error.message);
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return { error: "The photo could not be saved. Please try again." };
  }
  if (oldPath && oldPath !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]);
  }

  revalidatePath("/settings");
  return { success: "Profile photo updated." };
}

export async function removeAvatar(
  _previous: SettingsState,
  _formData: FormData,
): Promise<SettingsState> {
  void _formData;
  const { supabase } = await requireUser();
  const { data: oldPath, error } = await supabase.rpc("set_my_avatar", { p_path: null });
  if (error) {
    console.error("Avatar removal failed:", error.message);
    return { error: "The photo could not be removed. Please try again." };
  }
  if (oldPath) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]);
  }

  revalidatePath("/settings");
  return { success: "Profile photo removed." };
}

export async function changePassword(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { supabase, user } = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!current) {
    return { error: "Enter your current password." };
  }
  if (!passwordMeetsRules(next)) {
    return { error: "The new password does not meet the requirements." };
  }
  if (next !== confirm) {
    return { error: "The new passwords do not match." };
  }
  if (next === current) {
    return { error: "Choose a password different from your current one." };
  }
  if (!user.email) {
    return { error: "Your account has no email address to verify against." };
  }

  // Verify with a throwaway client so the browser session is not replaced.
  const { url, key } = getSupabaseConfig();
  const verifier = createStatelessClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyError) {
    return { error: "Your current password is incorrect." };
  }
  await verifier.auth.signOut();

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    console.error("Password update failed:", error.message);
    return { error: "The password could not be updated. It may be too common or recently used." };
  }

  await supabase.auth.signOut({ scope: "others" });
  return { success: "Password updated. Other devices have been signed out." };
}

export async function saveAppearance(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { supabase } = await requireUser();
  const theme = text(formData, "theme");
  const language = text(formData, "language");

  if (
    !(themes as readonly string[]).includes(theme) ||
    !languages.some((item) => item.value === language)
  ) {
    return { error: "Choose a valid theme and language." };
  }

  const { error } = await supabase.rpc("update_my_preferences", {
    p_theme: theme,
    p_language: language,
  });
  if (error) {
    console.error("Appearance save failed:", error.message);
    return { error: "Your preferences could not be saved. Please try again." };
  }

  (await cookies()).set(THEME_COOKIE, theme, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  (await cookies()).set(LANG_COOKIE, language, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  return { success: "Preferences saved." };
}

export async function saveNotifications(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { supabase } = await requireUser();
  const on = (name: string) => formData.get(name) === "on";

  const { error } = await supabase.rpc("update_my_preferences", {
    p_email_order_updates: on("email_order_updates"),
    p_email_stock_alerts: on("email_stock_alerts"),
    p_email_payment_alerts: on("email_payment_alerts"),
    p_inapp_order_updates: on("inapp_order_updates"),
    p_inapp_stock_alerts: on("inapp_stock_alerts"),
    p_inapp_payment_alerts: on("inapp_payment_alerts"),
  });
  if (error) {
    console.error("Notification save failed:", error.message);
    return { error: "Your notification settings could not be saved. Please try again." };
  }

  revalidatePath("/settings");
  return { success: "Notification settings saved." };
}

export async function sendMyRecoveryEmail(
  _previous: SettingsState,
  _formData: FormData,
): Promise<SettingsState> {
  void _formData;
  const { user } = await requireUser();
  if (!user.email) {
    return { error: "Your account has no email address." };
  }
  const sent = await sendRecoveryEmail(user.email);
  return sent
    ? { success: `A password reset link was sent to ${user.email}.` }
    : { error: "The reset email could not be sent. Please try again shortly." };
}

export async function signOutOtherSessions(
  _previous: SettingsState,
  _formData: FormData,
): Promise<SettingsState> {
  void _formData;
  const { supabase } = await requireUser();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.error("Sign out of other sessions failed:", error.message);
    return { error: "Other devices could not be signed out. Please try again." };
  }
  return { success: "All other devices have been signed out." };
}

export async function requestAccountDeletion(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { supabase } = await requireUser();
  const confirmation = text(formData, "confirmation");
  const reason = text(formData, "reason").slice(0, 500);

  if (confirmation !== "DELETE") {
    return { error: "Type DELETE to confirm the request." };
  }

  const { error } = await supabase.rpc("request_account_deletion", {
    p_confirm: confirmation,
    p_reason: reason || null,
  });
  if (error) {
    console.error("Deletion request failed:", error.message);
    return {
      error:
        error.code === "P0001"
          ? "You own an active business. Transfer ownership before requesting deletion."
          : "The request could not be submitted. Please try again.",
    };
  }

  revalidatePath("/settings");
  return { success: "Deletion request submitted for administrator review." };
}

export async function cancelAccountDeletion(
  _previous: SettingsState,
  _formData: FormData,
): Promise<SettingsState> {
  void _formData;
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) {
    console.error("Deletion cancel failed:", error.message);
    return { error: "The request could not be cancelled. Please try again." };
  }

  revalidatePath("/settings");
  return { success: "Deletion request cancelled." };
}
