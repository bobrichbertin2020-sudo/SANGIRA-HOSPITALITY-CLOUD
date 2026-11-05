import Link from "next/link";
import { signUp } from "@/app/sign-in/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PasswordInput } from "@/components/password-input";
import { getT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

export const instant = false;

type SignUpPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { error } = await searchParams;
  const { t } = await getT();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[#e3e9e4] bg-white p-7 shadow-sm sm:p-9">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold text-[#153d32]">
            ← Sangira
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="mt-6 flex justify-center">
          <Logo size="seal" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{t("Create your account")}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          {t("Start an application for your hospitality business.")}
        </p>
        {error === "invalid" && (
          <p role="alert" className="mt-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm leading-6 text-[#9c392d]">
            {t("Enter a valid name and email address, and use a password between 12 and 128 characters.")}
          </p>
        )}
        {error === "failed" && (
          <p role="alert" className="mt-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {t("We could not create your account. Check the details or try signing in.")}
          </p>
        )}
        <form action={signUp} className="mt-7 space-y-5">
          <label className="block text-sm font-medium text-[#33463a]">
            {t("Your name")}
            <input
              autoComplete="name"
              className="mt-2 w-full rounded-lg border border-[#d6ded8] px-3.5 py-3 text-[#17211c] outline-none transition focus:border-[#3e715c] focus:ring-2 focus:ring-[#3e715c]/15"
              maxLength={120}
              minLength={2}
              name="fullName"
              required
            />
          </label>
          <label className="block text-sm font-medium text-[#33463a]">
            {t("Email address")}
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-lg border border-[#d6ded8] px-3.5 py-3 text-[#17211c] outline-none transition focus:border-[#3e715c] focus:ring-2 focus:ring-[#3e715c]/15"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block text-sm font-medium text-[#33463a]">
            {t("Password")}
            <PasswordInput
              autoComplete="new-password"
              className="mt-2 w-full rounded-lg border border-[#d6ded8] px-3.5 py-3 text-[#17211c] outline-none transition focus:border-[#3e715c] focus:ring-2 focus:ring-[#3e715c]/15"
              minLength={12}
              maxLength={128}
              name="password"
              required
            />
            <span className="mt-1.5 block text-xs text-[#85938a]">
              {t("Use at least 12 characters.")}
            </span>
          </label>
          <button className="w-full rounded-lg bg-[#153d32] px-4 py-3 font-semibold text-white transition hover:bg-[#205443]">
            {t("Create account")}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[#64736a]">
          {t("Already registered?")}{" "}
          <Link className="font-semibold text-[#153d32] hover:underline" href="/sign-in">
            {t("Sign in")}
          </Link>
        </p>
      </section>
    </main>
  );
}
