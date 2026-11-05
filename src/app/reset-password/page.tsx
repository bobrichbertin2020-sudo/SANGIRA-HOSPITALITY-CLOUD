import { redirect } from "next/navigation";
import { resetPassword } from "@/app/forgot-password/actions";
import { NewPasswordFields } from "@/components/new-password-fields";
import { getT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";

export const instant = false;
export const metadata = { title: "Choose a new password" };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const { t } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in?error=link");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-[#e3e9e4] bg-white p-7 shadow-sm sm:p-9">
        <div className="mb-4 flex justify-center">
          <Logo size="seal" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("Choose a new password")}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          {t("Set a new password for {email}. Other devices will be signed out.", {
            email: user.email ?? "",
          })}
        </p>
        {error && (
          <p role="alert" className="mt-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {error === "failed"
              ? t("The password could not be updated. Try a different one.")
              : t("The password does not meet the requirements, or the two entries do not match.")}
          </p>
        )}
        <form action={resetPassword} className="mt-7 space-y-5">
          <NewPasswordFields withCurrent={false} />
          <button className="w-full rounded-lg bg-[#153d32] px-4 py-3 font-semibold text-white transition hover:bg-[#205443]">
            {t("Save new password")}
          </button>
        </form>
      </section>
    </main>
  );
}
