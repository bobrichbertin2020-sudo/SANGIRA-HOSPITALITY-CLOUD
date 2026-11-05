"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LANG_COOKIE, isLocale } from "@/lib/i18n/config";
import { THEME_COOKIE, type MyProfile } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/sign-in?error=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/sign-in?error=invalid");
  }

  // Carry saved preferences to this browser; ignored if the settings migration is not deployed.
  const { data: profile } = await supabase.rpc("get_my_profile").maybeSingle<MyProfile>();
  const cookieStore = await cookies();
  const cookieOptions = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
  if (profile?.theme) {
    cookieStore.set(THEME_COOKIE, profile.theme, cookieOptions);
  }
  if (isLocale(profile?.language)) {
    cookieStore.set(LANG_COOKIE, profile.language, cookieOptions);
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (
    fullName.length < 2 ||
    fullName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 12 ||
    password.length > 128
  ) {
    redirect("/sign-up?error=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: process.env.APP_BASE_URL
        ? `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/auth/callback`
        : undefined,
    },
  });

  if (error) {
    redirect("/sign-up?error=failed");
  }

  if (data.session) {
    redirect("/business/apply");
  }

  redirect("/sign-in?notice=check-email");
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(`Unable to sign out: ${error.message}`);
  }

  redirect("/");
}
