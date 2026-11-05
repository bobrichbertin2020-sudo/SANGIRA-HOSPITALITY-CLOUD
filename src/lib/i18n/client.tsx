"use client";

import { createContext, useContext, type ReactNode } from "react";
import { translate, type Locale } from "@/lib/i18n/config";

type Value = { locale: Locale; dictionary: Record<string, string> };

const I18nContext = createContext<Value>({ locale: "en", dictionary: {} });

export function I18nProvider({
  locale,
  dictionary,
  children,
}: Value & { children: ReactNode }) {
  return <I18nContext value={{ locale, dictionary }}>{children}</I18nContext>;
}

export function useT() {
  const { locale, dictionary } = useContext(I18nContext);
  return {
    locale,
    t: (text: string, vars?: Record<string, string | number>) =>
      translate(dictionary, text, vars),
  };
}
