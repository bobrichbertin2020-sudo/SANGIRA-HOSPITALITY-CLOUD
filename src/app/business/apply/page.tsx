import Link from "next/link";
import { redirect } from "next/navigation";
import { submitBusinessApplication } from "@/app/business/apply/actions";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type ApplyPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ApplyPage({ searchParams }: ApplyPageProps) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <main className="min-h-screen bg-[#f7f8f6] px-5 py-10 sm:py-16">
      <section className="mx-auto max-w-2xl rounded-2xl border border-[#e3e9e4] bg-white p-6 shadow-sm sm:p-9">
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          Business registration
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Tell us about your business
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#64736a]">
          Submit your details for platform review. Your management workspace is
          created after approval.
        </p>
        {error === "invalid" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            Review the form fields and correct any invalid values.
          </p>
        )}
        {error === "submit" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            Your application could not be submitted. Please try again.
          </p>
        )}
        <form action={submitBusinessApplication} className="mt-7 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[#33463a] sm:col-span-2">
            Business name
            <input
              className="form-input"
              maxLength={160}
              minLength={2}
              name="businessName"
              required
            />
          </label>
          <label className="block text-sm font-medium text-[#33463a]">
            Business type
            <select className="form-input" defaultValue="" name="businessType" required>
              <option disabled value="">
                Select a type
              </option>
              <option value="hotel">Hotel</option>
              <option value="restaurant">Restaurant</option>
              <option value="bar">Bar</option>
              <option value="lounge">Lounge</option>
              <option value="hotel_restaurant">Hotel and restaurant</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-[#33463a]">
            Country
            <input className="form-input" maxLength={100} name="country" required />
          </label>
          <label className="block text-sm font-medium text-[#33463a] sm:col-span-2">
            Business location
            <input className="form-input" maxLength={240} name="location" required />
          </label>
          <label className="block text-sm font-medium text-[#33463a]">
            Business contact email
            <input
              className="form-input"
              maxLength={254}
              name="contactEmail"
              required
              type="email"
            />
          </label>
          <label className="block text-sm font-medium text-[#33463a]">
            Business contact phone
            <input
              className="form-input"
              autoComplete="tel"
              maxLength={40}
              name="contactPhone"
              required
              type="tel"
            />
          </label>
          <label className="block text-sm font-medium text-[#33463a] sm:col-span-2">
            Business registration number
            <input className="form-input" maxLength={100} name="registrationNumber" />
          </label>
          <button className="mt-1 rounded-lg bg-[#153d32] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#205443] sm:col-span-2 sm:justify-self-start">
            Submit for review
          </button>
        </form>
      </section>
    </main>
  );
}
