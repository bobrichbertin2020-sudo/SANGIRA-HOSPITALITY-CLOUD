import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, isLocale, translate, type Locale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(value) ? value : "en";
}

export async function getT() {
  const locale = await getLocale();
  const dictionary = dictionaries[locale];
  return {
    locale,
    t: (text: string, vars?: Record<string, string | number>) =>
      translate(dictionary, text, vars),
  };
}
