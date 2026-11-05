"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { LANG_COOKIE, isLocale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";

export async function setLanguage(value: string) {
  if (!isLocale(value)) return;

  (await cookies()).set(LANG_COOKIE, value, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  // Signed-in users also keep the choice on their profile; failures only affect the saved copy.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { error } = await supabase.rpc("update_my_preferences", { p_language: value });
    if (error) console.error("Language preference not saved:", error.message);
  }
  revalidatePath("/", "layout");
}
