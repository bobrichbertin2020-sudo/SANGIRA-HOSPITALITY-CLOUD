"use client";

import { ChevronDown, KeyRound, Palette, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { useT } from "@/lib/i18n/client";

type MenuProps = {
  name: string;
  email: string;
  initials: string;
  avatarUrl: string | null;
  role: string | null;
};

export function AccountMenu({ name, email, initials, avatarUrl, role }: MenuProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
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

  const item =
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#29483c] hover:bg-[#f7f8f6]";

  return (
    <div className="relative" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("Account menu")}
        className="flex items-center gap-1.5 rounded-full border border-[#d6ded8] p-1 pr-2 hover:bg-[#f7f8f6]"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Avatar className="size-8 text-xs" profile={{ name, initials, avatarUrl }} />
        <ChevronDown aria-hidden="true" className="text-[#64736a]" size={14} />
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-[#e3e9e4] bg-white p-2 shadow-lg"
          role="menu"
        >
          <div className="border-b border-[#e3e9e4] px-3 pb-3 pt-2">
            <p className="truncate text-sm font-semibold text-[#17211c]">{name}</p>
            <p className="truncate text-xs text-[#64736a]">{email}</p>
            {role && (
              <p className="mt-1.5 inline-block rounded-full bg-[#e8f4ee] px-2.5 py-0.5 text-xs font-semibold text-[#285c3e]">
                {t(role)}
              </p>
            )}
          </div>
          <div className="pt-2">
            <Link className={item} href="/settings" onClick={() => setOpen(false)} role="menuitem">
              <UserRound aria-hidden="true" size={16} /> {t("Personal settings")}
            </Link>
            <Link
              className={item}
              href="/settings#security"
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              <KeyRound aria-hidden="true" size={16} /> {t("Change password")}
            </Link>
            <Link
              className={item}
              href="/settings#preferences"
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              <Palette aria-hidden="true" size={16} /> {t("Theme & language")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
