"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { PasswordInput } from "@/components/password-input";
import { useT } from "@/lib/i18n/client";
import { passwordRules, passwordStrength } from "@/lib/settings/password";

const barColors = ["bg-[#c2473a]", "bg-[#c2473a]", "bg-[#d99a2b]", "bg-[#7fae4f]", "bg-[#2f8a5b]"];

export function NewPasswordFields({ withCurrent }: { withCurrent: boolean }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="space-y-5">
      {withCurrent && (
        <label className="block text-sm font-medium text-[#33463a]">
          {t("Current password")}
          <PasswordInput
            autoComplete="current-password"
            className="form-input"
            name="currentPassword"
            required
          />
        </label>
      )}
      <label className="block text-sm font-medium text-[#33463a]">
        {t("New password")}
        <PasswordInput
          autoComplete="new-password"
          className="form-input"
          maxLength={128}
          minLength={12}
          name="newPassword"
          onChange={(event) => setPassword(event.target.value)}
          required
          value={password}
        />
      </label>
      <div aria-live="polite">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((index) => (
            <span
              className={`h-1.5 flex-1 rounded-full ${
                password && index < Math.max(strength.score, 1)
                  ? barColors[strength.score]
                  : "bg-[#e3e9e4]"
              }`}
              key={index}
            />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[#64736a]">
          {strength.label
            ? t("Strength: {label}", { label: t(strength.label) })
            : t("Enter a new password")}
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {passwordRules.map((rule) => {
            const met = rule.test(password);
            const Icon = met ? Check : X;
            return (
              <li
                className={`flex items-center gap-1.5 text-xs ${met ? "text-[#285c3e]" : "text-[#85938a]"}`}
                key={rule.id}
              >
                <Icon aria-hidden="true" size={14} />
                {t(rule.label)}
              </li>
            );
          })}
        </ul>
      </div>
      <label className="block text-sm font-medium text-[#33463a]">
        {t("Confirm new password")}
        <PasswordInput
          autoComplete="new-password"
          className="form-input"
          maxLength={128}
          name="confirmPassword"
          onChange={(event) => setConfirm(event.target.value)}
          required
          value={confirm}
        />
      </label>
      {mismatch && (
        <p role="alert" className="text-xs text-[#9c392d]">
          {t("The passwords do not match.")}
        </p>
      )}
    </div>
  );
}
