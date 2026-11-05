"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { useT } from "@/lib/i18n/client";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

export function PasswordInput({ className = "", ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const { t } = useT();
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <input {...props} className={`${className} pr-11`} type={visible ? "text" : "password"} />
      <button
        aria-label={visible ? t("Hide password") : t("Show password")}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 mt-2 flex w-11 items-center justify-center text-[#64736a] hover:text-[#153d32]"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>
    </div>
  );
}
