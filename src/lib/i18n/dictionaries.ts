import type { Locale } from "@/lib/i18n/config";
import { fr } from "@/lib/i18n/dictionaries/fr";
import { rw } from "@/lib/i18n/dictionaries/rw";
import { settingsDict } from "@/lib/i18n/dictionaries/settings";
import { sw } from "@/lib/i18n/dictionaries/sw";

export const dictionaries: Record<Locale, Record<string, string>> = {
  en: {},
  sw: { ...sw, ...settingsDict.sw },
  fr: { ...fr, ...settingsDict.fr },
  rw: { ...rw, ...settingsDict.rw },
};
