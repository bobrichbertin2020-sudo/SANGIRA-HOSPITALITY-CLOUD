import Link from "next/link";
import { redirect } from "next/navigation";
import { UploadDocumentForm } from "@/app/documents/upload-form";
import { categoryLabels, type DocumentCategory } from "@/lib/documents/files";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ApplicationDocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { data: application, error } = await supabase
    .from("business_applications")
    .select("id, business_name, status")
    .eq("applicant_user_id", user.id)
    .in("status", ["submitted", "under_review"])
    .maybeSingle();

  const { data: documents } = application
    ? await supabase
        .from("business_documents")
        .select("id, category, original_name, size_bytes, created_at")
        .eq("application_id", application.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <main className="min-h-screen bg-[#f7f8f6] px-5 py-10 sm:py-16">
      <section className="mx-auto max-w-2xl space-y-6">
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
            Business registration
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Supporting documents</h1>
          <p className="mt-2 text-sm text-[#64736a]">
            Upload your registration certificate and verification documents. Only you and Sangira
            platform reviewers can see them.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            Your application could not be loaded.
          </p>
        )}
        {!error && !application && (
          <p className="rounded-xl border border-dashed border-[#d6ded8] px-5 py-8 text-center text-sm text-[#64736a]">
            You have no application awaiting review.{" "}
            <Link className="font-semibold text-[#153d32] hover:underline" href="/business/apply">
              Start one
            </Link>
          </p>
        )}
        {application && (
          <>
            <p className="text-sm font-medium">Application: {application.business_name}</p>
            <UploadDocumentForm
              categories={[
                { value: "registration", label: categoryLabels.registration },
                { value: "verification", label: categoryLabels.verification },
              ]}
              ownerId={application.id}
              scope="application"
            />
            <ul className="divide-y divide-[#eef2ef] rounded-xl border border-[#e3e9e4] bg-white text-sm">
              {(documents ?? []).length === 0 && (
                <li className="px-5 py-4 text-[#64736a]">No documents uploaded yet.</li>
              )}
              {(documents ?? []).map((document) => (
                <li key={document.id} className="flex items-center justify-between px-5 py-3">
                  <span>
                    {document.original_name}{" "}
                    <span className="text-xs text-[#64736a]">
                      ({categoryLabels[document.category as DocumentCategory]})
                    </span>
                  </span>
                  <a
                    className="font-semibold text-[#153d32] hover:underline"
                    href={`/api/documents/${document.id}/download`}
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
