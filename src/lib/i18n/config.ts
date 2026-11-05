export const locales = ["en", "sw", "fr", "rw"] as const;
export type Locale = (typeof locales)[number];

export const LANG_COOKIE = "sgr_lang";

export const localeLabels: Record<Locale, { name: string; code: string }> = {
  en: { name: "English", code: "EN" },
  sw: { name: "Kiswahili", code: "SW" },
  fr: { name: "Français", code: "FR" },
  rw: { name: "Kinyarwanda", code: "RW" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

// English text is the key, so untranslated strings fall back to English automatically.
export function translate(
  dictionary: Record<string, string> | undefined,
  text: string,
  vars?: Record<string, string | number>,
) {
  let result = dictionary?.[text] ?? text;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      result = result.replaceAll(`{${name}}`, String(value));
    }
  }
  return result;
}
