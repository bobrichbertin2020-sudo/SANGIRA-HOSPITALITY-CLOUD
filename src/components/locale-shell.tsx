import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/client";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/server";

export async function LocaleShell({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider dictionary={dictionaries[locale]} locale={locale}>
      {children}
    </I18nProvider>
  );
}
