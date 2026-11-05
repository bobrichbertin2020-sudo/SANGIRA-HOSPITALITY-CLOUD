"use client";

import {
  LogOut,
  Mail,
  Monitor,
  Moon,
  Sun,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  cancelAccountDeletion,
  changePassword,
  removeAvatar,
  requestAccountDeletion,
  saveAppearance,
  saveNotifications,
  sendMyRecoveryEmail,
  signOutOtherSessions,
  updateProfile,
  uploadAvatar,
  type SettingsState,
} from "@/app/settings/actions";
import { FormMessage, Modal, SubmitButton, inputClass } from "@/app/settings/ui";
import { NewPasswordFields } from "@/components/new-password-fields";
import { useT } from "@/lib/i18n/client";
import { MAX_AVATAR_BYTES, THEME_COOKIE, languages, type Theme } from "@/lib/settings/options";

const initial: SettingsState = {};

export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// A new browser has no theme cookie yet; align it with the saved preference.
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    const current = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([a-z]+)`))?.[1];
    if (current !== theme) {
      document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
    }
    applyTheme(theme);
  }, [theme]);
  return null;
}

type ProfileValues = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  address: string;
  language: string;
};

export function ProfileForm({ values }: { values: ProfileValues }) {
  const { t } = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(updateProfile, initial);

  const field = (label: string, name: keyof ProfileValues, props: Record<string, unknown> = {}) => (
    <label className="block text-sm font-medium text-[#33463a]">
      {t(label)}
      <input
        className={inputClass}
        defaultValue={values[name]}
        name={name}
        {...props}
      />
    </label>
  );

  return (
    <form action={formAction} className="space-y-5" ref={formRef}>
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        {field("First name", "firstName", { autoComplete: "given-name", maxLength: 80, required: true })}
        {field("Last name", "lastName", { autoComplete: "family-name", maxLength: 80, required: true })}
        {field("Username", "username", {
          autoComplete: "username",
          maxLength: 30,
          pattern: "[a-z0-9_.]{3,30}",
          placeholder: t("optional"),
          title: t("3-30 lowercase letters, numbers, dots or underscores"),
        })}
        {field("Phone number", "phone", { autoComplete: "tel", inputMode: "tel", maxLength: 20, placeholder: "+256700000000" })}
        {field("Email address", "email", { autoComplete: "email", maxLength: 254, required: true, type: "email" })}
        <label className="block text-sm font-medium text-[#33463a]">
          {t("Preferred language")}
          <select
            className={inputClass}
            defaultValue={values.language}
            name="language"
          >
            {languages.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          {field("Residential address", "address", { autoComplete: "street-address", maxLength: 240, placeholder: t("optional") })}
        </div>
      </div>
      <p className="text-xs text-[#64736a]">
        {t("Changing your email sends a confirmation link; the new address is used for sign-in only after you confirm it.")}
      </p>
      <div className="flex flex-wrap gap-3">
        <SubmitButton pending={pending}>{t("Save changes")}</SubmitButton>
        <button
          className="rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]"
          onClick={() => formRef.current?.reset()}
          type="button"
        >
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

export function PhotoForm({
  avatarUrl,
  initials,
}: {
  avatarUrl: string | null;
  initials: string;
}) {
  const { t } = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: SettingsState, formData: FormData) => {
      const result = await uploadAvatar(previous, formData);
      if (result.success) {
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      }
      return result;
    },
    initial,
  );
  const [removeState, removeAction, removing] = useActionState(removeAvatar, initial);
  const shown = preview ?? avatarUrl;

  return (
    <div className="space-y-4">
      <FormMessage state={clientError ? { error: clientError } : state.error || state.success ? state : removeState} />
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#d6ded8] bg-[#e8f4ee] text-2xl font-semibold text-[#153d32]">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={t("Profile photo preview")} className="size-full object-cover" src={shown} />
          ) : initials ? (
            initials
          ) : (
            <UserRound aria-hidden="true" size={36} />
          )}
        </div>
        <form action={formAction} className="space-y-3">
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label={t("Choose a profile photo")}
            className="block w-full text-sm text-[#64736a] file:mr-3 file:rounded-lg file:border file:border-[#d6ded8] file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#29483c]"
            name="photo"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setClientError(null);
              if (preview) URL.revokeObjectURL(preview);
              if (!file) return setPreview(null);
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                event.target.value = "";
                setPreview(null);
                return setClientError("Use a JPEG, PNG or WebP image.");
              }
              if (file.size > MAX_AVATAR_BYTES) {
                event.target.value = "";
                setPreview(null);
                return setClientError("The photo must be 2 MB or smaller.");
              }
              setPreview(URL.createObjectURL(file));
            }}
            ref={fileRef}
            required
            type="file"
          />
          <p className="text-xs text-[#85938a]">{t("JPEG, PNG or WebP, up to 2 MB.")}</p>
          <div className="flex flex-wrap gap-3">
            <SubmitButton disabled={!preview} pending={pending} pendingLabel="Uploading...">
              <span className="inline-flex items-center gap-2">
                <Upload aria-hidden="true" size={16} />
                {avatarUrl ? t("Replace photo") : t("Save photo")}
              </span>
            </SubmitButton>
          </div>
        </form>
      </div>
      {avatarUrl && !preview && (
        <Modal
          description="Your profile photo will be deleted and replaced with your initials."
          title="Remove profile photo?"
          tone="danger"
          triggerIcon={<Trash2 aria-hidden="true" size={16} />}
          triggerLabel="Remove photo"
        >
          {(close) => (
            <form action={removeAction} className="flex justify-end gap-3" onSubmit={() => setTimeout(close, 0)}>
              <button
                className="rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c]"
                onClick={close}
                type="button"
              >
                {t("Keep photo")}
              </button>
              <SubmitButton pending={removing} pendingLabel="Removing..." tone="danger">
                {t("Remove")}
              </SubmitButton>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

export function PasswordForm() {
  const { t } = useT();
  const [version, setVersion] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (previous: SettingsState, formData: FormData) => {
      const result = await changePassword(previous, formData);
      if (result.success) setVersion((current) => current + 1);
      return result;
    },
    initial,
  );

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      <FormMessage state={state} />
      <NewPasswordFields key={version} withCurrent />
      <SubmitButton pending={pending} pendingLabel="Updating...">
        {t("Save new password")}
      </SubmitButton>
    </form>
  );
}

export function RecoveryButton() {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(sendMyRecoveryEmail, initial);
  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <button
        className="inline-flex items-center gap-2 rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6] disabled:opacity-60"
        disabled={pending}
      >
        <Mail aria-hidden="true" size={16} />
        {pending ? t("Sending...") : t("Email me a password reset link")}
      </button>
    </form>
  );
}

export function AppearanceForm({ theme, language }: { theme: Theme; language: string }) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(
    async (previous: SettingsState, formData: FormData) => {
      const result = await saveAppearance(previous, formData);
      if (result.success) applyTheme(String(formData.get("theme")) as Theme);
      return result;
    },
    initial,
  );
  const options = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ] as const;

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />
      <fieldset>
        <legend className="text-sm font-medium text-[#33463a]">{t("Theme")}</legend>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {options.map(({ value, label, Icon }) => (
            <label className="cursor-pointer" key={value}>
              <input className="peer sr-only" defaultChecked={theme === value} name="theme" type="radio" value={value} />
              <span className="flex flex-col items-center gap-1.5 rounded-xl border border-[#d6ded8] px-3 py-3 text-sm font-medium text-[#33463a] peer-checked:border-[#3e715c] peer-checked:bg-[#e8f4ee] peer-focus-visible:ring-2 peer-focus-visible:ring-[#3e715c]">
                <Icon aria-hidden="true" size={20} />
                {t(label)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block max-w-xs text-sm font-medium text-[#33463a]">
        {t("Preferred language")}
        <select className={inputClass} defaultValue={language} name="language">
          {languages.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-[#85938a]">
        {t("Your language is saved to your account and applies across the app.")}
      </p>
      <SubmitButton pending={pending}>{t("Save preferences")}</SubmitButton>
    </form>
  );
}

type NotificationValues = Record<
  | "email_order_updates"
  | "email_stock_alerts"
  | "email_payment_alerts"
  | "inapp_order_updates"
  | "inapp_stock_alerts"
  | "inapp_payment_alerts",
  boolean
>;

export function NotificationsForm({ values }: { values: NotificationValues }) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(saveNotifications, initial);
  const rows = [
    { key: "order_updates", label: "Order updates", hint: "New, ready and cancelled orders" },
    { key: "stock_alerts", label: "Stock alerts", hint: "Low stock and stock requests" },
    { key: "payment_alerts", label: "Payment alerts", hint: "Payments received and failures" },
  ] as const;

  return (
    <form action={formAction} className="space-y-5">
      <FormMessage state={state} />
      <div className="overflow-hidden rounded-xl border border-[#e3e9e4]">
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 bg-[#f7f8f6] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#64736a]">
          <span>{t("Notify me about")}</span>
          <span className="text-center">{t("Email")}</span>
          <span className="text-center">{t("In-app")}</span>
        </div>
        <ul className="divide-y divide-[#edf0ed]">
          {rows.map((row) => (
            <li className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 px-4 py-3" key={row.key}>
              <div>
                <p className="text-sm font-medium">{t(row.label)}</p>
                <p className="text-xs text-[#85938a]">{t(row.hint)}</p>
              </div>
              {(["email", "inapp"] as const).map((channel) => {
                const name = `${channel}_${row.key}` as keyof NotificationValues;
                return (
                  <label className="flex justify-center" key={name}>
                    <span className="sr-only">
                      {t(channel === "email" ? "{label} by email" : "{label} in-app", { label: t(row.label) })}
                    </span>
                    <input
                      className="size-5 accent-[#153d32]"
                      defaultChecked={values[name]}
                      name={name}
                      type="checkbox"
                    />
                  </label>
                );
              })}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-[#85938a]">
        {t("Choices are saved to your account and applied as notification delivery is switched on for your business.")}
      </p>
      <SubmitButton pending={pending}>{t("Save notification settings")}</SubmitButton>
    </form>
  );
}

export function SignOutOthers() {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(signOutOtherSessions, initial);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <Modal
        description="Every other browser and device signed in to your account will be signed out. This device stays signed in."
        title="Sign out other devices?"
        triggerIcon={<LogOut aria-hidden="true" size={16} />}
        triggerLabel="Sign out other devices"
      >
        {(close) => (
          <form action={formAction} className="flex justify-end gap-3" onSubmit={() => setTimeout(close, 0)}>
            <button
              className="rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c]"
              onClick={close}
              type="button"
            >
              {t("Cancel")}
            </button>
            <SubmitButton pending={pending} pendingLabel="Signing out...">
              {t("Sign out others")}
            </SubmitButton>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function DeletionPanel({ pendingSince }: { pendingSince: string | null }) {
  const { t } = useT();
  const [state, formAction, pending] = useActionState(requestAccountDeletion, initial);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelAccountDeletion, initial);
  const [typed, setTyped] = useState("");

  if (pendingSince) {
    return (
      <form action={cancelAction} className="space-y-3">
        <FormMessage state={cancelState} />
        <p className="rounded-lg bg-[#fff9ed] px-3.5 py-2.5 text-sm text-[#765321]">
          {t("A deletion request was submitted on {date}. An administrator will review it.", { date: pendingSince })}
        </p>
        <SubmitButton pending={cancelling} pendingLabel="Cancelling...">
          {t("Cancel deletion request")}
        </SubmitButton>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <Modal
        description="Your request is reviewed by an administrator. Orders, payments, stock movements and audit entries you created are kept for the business's records and remain linked to your name. You cannot delete business transaction records by deleting your account."
        title="Request account deletion?"
        tone="danger"
        triggerIcon={<Trash2 aria-hidden="true" size={16} />}
        triggerLabel="Request account deletion"
      >
        {(close) => (
          <form action={formAction} className="space-y-4" onSubmit={() => setTimeout(close, 0)}>
            <label className="block text-sm font-medium text-[#33463a]">
              {t("Reason (optional)")}
              <textarea className={inputClass} maxLength={500} name="reason" rows={2} />
            </label>
            <label className="block text-sm font-medium text-[#33463a]">
              {t("Type DELETE to confirm")}
              <input
                autoComplete="off"
                className={inputClass}
                name="confirmation"
                onChange={(event) => setTyped(event.target.value)}
                value={typed}
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                className="rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c]"
                onClick={close}
                type="button"
              >
                {t("Cancel")}
              </button>
              <SubmitButton
                disabled={typed !== "DELETE"}
                pending={pending}
                pendingLabel="Submitting..."
                tone="danger"
              >
                {t("Submit request")}
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
