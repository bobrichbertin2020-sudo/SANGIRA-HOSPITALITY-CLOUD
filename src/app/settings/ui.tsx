"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";

export const inputClass = "form-input";

export function FormMessage({ state }: { state: { error?: string; success?: string } }) {
  const { t } = useT();
  if (state.error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg bg-[#fff1ee] px-3.5 py-2.5 text-sm text-[#9c392d]"
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
        {t(state.error)}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-3.5 py-2.5 text-sm text-[#285c3e]"
      >
        <CircleCheck aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
        {t(state.success)}
      </p>
    );
  }
  return null;
}

export function SubmitButton({
  children,
  pending,
  pendingLabel = "Saving...",
  tone = "primary",
  disabled,
}: {
  children: ReactNode;
  pending: boolean;
  pendingLabel?: string;
  tone?: "primary" | "danger";
  disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${
        tone === "danger" ? "bg-[#9c392d] hover:bg-[#832e24]" : "bg-[#153d32] hover:bg-[#205443]"
      }`}
      disabled={pending || disabled}
    >
      {pending && <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />}
      {pending ? t(pendingLabel) : children}
    </button>
  );
}

export function Modal({
  triggerLabel,
  triggerIcon,
  title,
  description,
  children,
  tone = "default",
}: {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  title: string;
  description: string;
  children: (close: () => void) => ReactNode;
  tone?: "default" | "danger";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useT();

  return (
    <>
      <button
        className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold ${
          tone === "danger"
            ? "border-[#e8c9c3] text-[#9c392d] hover:bg-[#fff1ee]"
            : "border-[#d6ded8] text-[#29483c] hover:bg-[#f7f8f6]"
        }`}
        onClick={() => ref.current?.showModal()}
        type="button"
      >
        {triggerIcon}
        {t(triggerLabel)}
      </button>
      <dialog
        aria-labelledby={titleId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[#e3e9e4] bg-white p-6 text-[#17211c] shadow-xl backdrop:bg-black/40"
        ref={ref}
      >
        <h3 className="text-lg font-semibold" id={titleId}>
          {t(title)}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">{t(description)}</p>
        <div className="mt-5">{children(() => document.getElementById(titleId)?.closest("dialog")?.close())}</div>
      </dialog>
    </>
  );
}
