import Link from "next/link";
import { requestPasswordReset } from "@/app/forgot-password/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

export const instant = false;
export const metadata = { title: "Reset your password" };

type Props = { searchParams: Promise<{ error?: string; sent?: string }> };

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const { error, sent } = await searchParams;
  const { t } = await getT();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[#e3e9e4] bg-white p-7 shadow-sm sm:p-9">
        <div className="flex items-center justify-between">
          <Link href="/sign-in" className="text-sm font-semibold text-[#153d32]">
            ← {t("Sign in")}
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="mt-6 flex justify-center">
          <Logo size="seal" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{t("Reset your password")}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          {t("Enter your account email and we will send you a link to choose a new password.")}
        </p>
        {sent && (
          <p className="mt-5 rounded-lg bg-[#edf6ef] px-4 py-3 text-sm leading-6 text-[#285c3e]">
            {t("If an account exists for that email, a reset link is on its way. Open it in this browser.")}
          </p>
        )}
        {error === "invalid" && (
          <p role="alert" className="mt-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {t("Enter a valid email address.")}
          </p>
        )}
        <form action={requestPasswordReset} className="mt-7 space-y-5">
          <label className="block text-sm font-medium text-[#33463a]">
            {t("Email address")}
            <input autoComplete="email" className="form-input" name="email" required type="email" />
          </label>
          <button className="w-full rounded-lg bg-[#153d32] px-4 py-3 font-semibold text-white transition hover:bg-[#205443]">
            {t("Send reset link")}
          </button>
        </form>
      </section>
    </main>
  );
}
