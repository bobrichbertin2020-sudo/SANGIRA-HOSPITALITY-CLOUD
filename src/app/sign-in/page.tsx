import Link from "next/link";
import { signIn } from "@/app/sign-in/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PasswordInput } from "@/components/password-input";
import { getT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";

export const instant = false;

type SignInPageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error, notice } = await searchParams;
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
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{t("Welcome back")}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          {t("Sign in to continue to your hospitality workspace.")}
        </p>
        {notice === "check-email" && (
          <p className="mt-5 rounded-lg bg-[#edf6ef] px-4 py-3 text-sm leading-6 text-[#285c3e]">
            {t("Check your email to confirm your account, then sign in.")}
          </p>
        )}
        {error === "link" && (
          <p role="alert" className="mt-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {t("That confirmation link is invalid or expired. Sign in, or sign up again for a new link.")}
          </p>
        )}
        {error === "invalid" && (
          <p role="alert" className="mt-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {t("Your email or password is incorrect. Check your details and try again.")}
          </p>
        )}
        <form action={signIn} className="mt-7 space-y-5">
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
              autoComplete="current-password"
              className="mt-2 w-full rounded-lg border border-[#d6ded8] px-3.5 py-3 text-[#17211c] outline-none transition focus:border-[#3e715c] focus:ring-2 focus:ring-[#3e715c]/15"
              name="password"
              required
            />
          </label>
          <Link className="block text-right text-sm font-semibold text-[#153d32] hover:underline" href="/forgot-password">
            {t("Forgot your password?")}
          </Link>
          <button className="w-full rounded-lg bg-[#153d32] px-4 py-3 font-semibold text-white transition hover:bg-[#205443]">
            {t("Sign in")}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[#64736a]">
          {t("New to Sangira?")}{" "}
          <Link className="font-semibold text-[#153d32] hover:underline" href="/sign-up">
            {t("Create an account")}
          </Link>
        </p>
      </section>
    </main>
  );
}
