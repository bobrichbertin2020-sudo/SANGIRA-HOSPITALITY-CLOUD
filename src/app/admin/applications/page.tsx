import Link from "next/link";
import { Logo } from "@/components/logo";
import { redirect } from "next/navigation";
import { reviewApplication } from "@/app/admin/applications/actions";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type AdminApplicationsPageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function AdminApplicationsPage({
  searchParams,
}: AdminApplicationsPageProps) {
  const { error, notice } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const { data: isPlatformAdmin, error: roleError } = await supabase.rpc(
    "is_platform_admin",
  );

  if (roleError) {
    console.error("Unable to verify platform administrator access:", roleError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Platform administrator access could not be verified. Confirm the database migration is applied.
        </p>
      </main>
    );
  }

  if (!isPlatformAdmin) {
    redirect("/dashboard");
  }

  const { data: applications, error: applicationsError } = await supabase
    .from("business_applications")
    .select(
      "id, applicant_user_id, business_name, business_type, country, location, contact_email, contact_phone, registration_number, status, created_at",
    )
    .in("status", ["submitted", "under_review"])
    .order("created_at", { ascending: true });

  const applicationIds = (applications ?? []).map((application) => application.id);
  const { data: applicationDocuments } = applicationIds.length
    ? await supabase
        .from("business_documents")
        .select("id, application_id, category, original_name")
        .in("application_id", applicationIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-3">
            <AccountLink />
            <form action={signOut}>
              <button className="rounded-lg border border-[#d6ded8] px-4 py-2 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          Platform administration
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Business applications</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          Review new registrations. Approval creates the tenant, owner membership, default departments, and audit event in one database transaction.
        </p>
        {notice === "reviewed" && (
          <p className="mt-6 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
            The application has been reviewed.
          </p>
        )}
        {error === "invalid" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            The review details are invalid.
          </p>
        )}
        {error === "review" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            The application could not be reviewed. It may have already been handled.
          </p>
        )}
        {applicationsError ? (
          <p role="alert" className="mt-8 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            Applications could not be loaded.
          </p>
        ) : applications?.length ? (
          <ul className="mt-8 space-y-5">
            {applications.map((application) => (
              <li
                className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8"
                key={application.id}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{application.business_name}</h2>
                    <p className="mt-1 text-sm capitalize text-[#64736a]">
                      {application.business_type.replaceAll("_", " ")} · {application.country}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-[#f2f4f2] px-3 py-1 text-xs font-semibold capitalize text-[#53635a]">
                    {application.status}
                  </span>
                </div>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-[#85938a]">Location</dt>
                    <dd className="mt-1">{application.location}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#85938a]">Contact</dt>
                    <dd className="mt-1">{application.contact_email} · {application.contact_phone}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#85938a]">Registration number</dt>
                    <dd className="mt-1">{application.registration_number ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-[#85938a]">Submitted</dt>
                    <dd className="mt-1">
                      {new Date(application.created_at).toLocaleString("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 text-sm">
                  <p className="text-xs font-medium text-[#85938a]">Uploaded documents</p>
                  <ul className="mt-1 space-y-1">
                    {(applicationDocuments ?? []).filter(
                      (document) => document.application_id === application.id,
                    ).length === 0 && <li className="text-[#64736a]">None uploaded.</li>}
                    {(applicationDocuments ?? [])
                      .filter((document) => document.application_id === application.id)
                      .map((document) => (
                        <li key={document.id}>
                          <a
                            className="font-semibold text-[#153d32] hover:underline"
                            href={`/api/documents/${document.id}/download`}
                          >
                            {document.original_name}
                          </a>{" "}
                          <span className="text-xs capitalize text-[#64736a]">
                            ({document.category})
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
                {application.applicant_user_id === user.id ? (
                  <p className="mt-5 rounded-lg bg-[#fff9ed] px-4 py-3 text-sm text-[#765321]">
                    You submitted this application and cannot review it.
                  </p>
                ) : (
                  <form action={reviewApplication} className="mt-6 border-t border-[#edf0ed] pt-5">
                    <input name="applicationId" type="hidden" value={application.id} />
                    <label className="block text-sm font-medium text-[#33463a]">
                      Review notes (optional)
                      <textarea
                        className="form-input min-h-20 resize-y"
                        maxLength={2000}
                        name="reviewNotes"
                      />
                    </label>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        className="rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#205443]"
                        name="decision"
                        value="approved"
                      >
                        Approve and create workspace
                      </button>
                      <button
                        className="rounded-lg border border-[#e8c9c3] px-4 py-2.5 text-sm font-semibold text-[#9c392d] hover:bg-[#fff1ee]"
                        name="decision"
                        value="rejected"
                      >
                        Reject application
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-[#d6ded8] bg-white px-6 py-12 text-center">
            <p className="font-medium">No applications awaiting review</p>
          </div>
        )}
      </section>
    </main>
  );
}
