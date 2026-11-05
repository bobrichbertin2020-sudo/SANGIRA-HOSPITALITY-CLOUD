import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptStaffInvitation } from "@/app/business/[businessId]/staff/actions";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type AcceptInvitationPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function AcceptInvitationPage({
  searchParams,
}: AcceptInvitationPageProps) {
  const { token } = await searchParams;

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    redirect("/sign-in");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError && sessionError.name !== "AuthSessionMissingError") {
    console.error("Unable to verify invitation recipient session:", sessionError.message);
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-5">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Your sign-in could not be verified. Try again.
        </p>
      </main>
    );
  }

  const signedInUser =
    sessionError?.name === "AuthSessionMissingError" ? null : user;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-[#e3e9e4] bg-white p-7 shadow-sm sm:p-9">
        <Link href="/" className="text-sm font-semibold text-[#153d32]">
          ← Sangira
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">
          Join a business workspace
        </h1>
        {signedInUser ? (
          <>
            <p className="mt-3 text-sm leading-6 text-[#64736a]">
              You are signed in as <strong>{signedInUser.email}</strong>. Accepting this
              invitation will add the assigned business roles and department access
              to your account.
            </p>
            <form action={acceptStaffInvitation} className="mt-7">
              <input name="token" type="hidden" value={token} />
              <button className="w-full rounded-lg bg-[#153d32] px-4 py-3 font-semibold text-white transition hover:bg-[#205443]">
                Accept invitation
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-[#64736a]">
              Sign in or create an account using the email address this invitation
              was sent to, verify that email, then reopen this invitation link.
              The link can only be used once.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                className="rounded-lg bg-[#153d32] px-4 py-3 text-sm font-semibold text-white hover:bg-[#205443]"
                href="/sign-in"
              >
                Sign in
              </Link>
              <Link
                className="rounded-lg border border-[#d6ded8] px-4 py-3 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]"
                href="/sign-up"
              >
                Create account
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
