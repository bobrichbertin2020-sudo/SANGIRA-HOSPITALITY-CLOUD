import type { Metadata } from "next";
import Script from "next/script";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { LocaleShell } from "@/components/locale-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sangira | Hospitality operations",
    template: "%s | Sangira",
  },
  description:
    "A connected hospitality management platform for hotels, restaurants, bars, and lounges.",
  referrer: "no-referrer",
};

const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )sgr_theme=([^;]*)/);var t=m?m[1]:"system";if(t==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t;var l=document.cookie.match(/(?:^|; )sgr_lang=(en|sw|fr|rw)/);if(l){document.documentElement.lang=l[1]}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <Script id="sgr-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <LocaleShell>{children}</LocaleShell>
        </Suspense>
      </body>
    </html>
  );
}
