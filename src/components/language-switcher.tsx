"use client";

import { Check, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { locales, localeLabels } from "@/lib/i18n/config";
import { setLanguage } from "@/lib/i18n/actions";
import { useT } from "@/lib/i18n/client";

export function LanguageSwitcher() {
  const { locale, t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: (typeof locales)[number]) {
    setOpen(false);
    if (next === locale) return;
    startTransition(async () => {
      await setLanguage(next);
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("Change language")}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#d6ded8] px-3 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6] disabled:opacity-60"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Globe aria-hidden="true" size={16} />
        {localeLabels[locale].code}
      </button>
      {open && (
        <ul
          className="absolute right-0 z-30 mt-2 w-44 rounded-xl border border-[#e3e9e4] bg-white p-1.5 shadow-lg"
          role="menu"
        >
          {locales.map((item) => (
            <li key={item} role="none">
              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-[#29483c] hover:bg-[#f7f8f6]"
                onClick={() => choose(item)}
                role="menuitemradio"
                aria-checked={item === locale}
                type="button"
              >
                {localeLabels[item].name}
                {item === locale && <Check aria-hidden="true" size={15} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
