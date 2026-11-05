import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { UploadDocumentForm } from "@/app/documents/upload-form";
import { categoryLabels, type DocumentCategory } from "@/lib/documents/files";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type DocumentsPageProps = {
  params: Promise<{ businessId: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatSize(bytes: number) {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { businessId } = await params;
  if (!uuidPattern.test(businessId)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const checks = await Promise.all(
    ["business.manage", "inventory.manage", "payments.manage", "reports.view"].map((key) =>
      supabase.rpc("has_business_permission", { p_business_id: businessId, p_permission_key: key }),
    ),
  );
  if (checks.some((check) => check.error)) {
    console.error("Document permission check failed");
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Access could not be verified. Confirm the documents migration is applied.
        </p>
      </main>
    );
  }
  const [canManageBusiness, canManageInventory, canManagePayments, canViewReports] =
    checks.map((check) => Boolean(check.data));
  if (!canManageBusiness && !canManageInventory && !canManagePayments && !canViewReports) {
    redirect("/dashboard");
  }

  const uploadCategories: DocumentCategory[] = [
    ...(canManageBusiness ? (["registration", "verification"] as const) : []),
    ...(canManageInventory ? (["supplier_invoice", "receipt"] as const) : []),
    ...(!canManageInventory && canManagePayments ? (["receipt"] as const) : []),
  ];

  const [{ data: business }, { data: documents, error: documentsError }, { data: suppliers }] =
    await Promise.all([
      supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
      supabase
        .from("business_documents")
        .select("id, category, original_name, mime_type, size_bytes, supplier_id, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(100),
      canManageInventory
        ? supabase
            .from("suppliers")
            .select("id, name")
            .eq("business_id", businessId)
            .eq("is_active", true)
            .order("name")
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
  if (!business) {
    notFound();
  }

  const supplierNames = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
      <section className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
        <Link className="text-sm font-semibold text-[#153d32] hover:underline" href="/dashboard">
          ← Dashboard
        </Link>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          {business.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          Files are stored privately. Each download uses a link that expires after one minute,
          and every download is recorded in the audit log. Uploaded files cannot be edited.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          {uploadCategories.length > 0 ? (
            <UploadDocumentForm
              categories={uploadCategories.map((value) => ({
                value,
                label: categoryLabels[value],
              }))}
              ownerId={businessId}
              scope="business"
              suppliers={suppliers ?? []}
            />
          ) : (
            <p className="text-sm text-[#64736a]">You can view documents but not upload them.</p>
          )}

          <section>
            <h2 className="font-semibold">Stored documents</h2>
            {documentsError && (
              <p role="alert" className="mt-3 rounded-lg bg-[#fff1ee] px-3 py-2 text-sm text-[#9c392d]">
                Documents could not be loaded.
              </p>
            )}
            <ul className="mt-3 divide-y divide-[#eef2ef] rounded-xl border border-[#e3e9e4] bg-white text-sm">
              {(documents ?? []).length === 0 && (
                <li className="px-5 py-4 text-[#64736a]">No documents yet.</li>
              )}
              {(documents ?? []).map((document) => (
                <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="font-medium">{document.original_name}</p>
                    <p className="text-xs text-[#64736a]">
                      {categoryLabels[document.category as DocumentCategory]}
                      {document.supplier_id && supplierNames.get(document.supplier_id)
                        ? ` · ${supplierNames.get(document.supplier_id)}`
                        : ""}{" "}
                      · {formatSize(Number(document.size_bytes))} ·{" "}
                      {dateTime.format(new Date(document.created_at))}
                    </p>
                  </div>
                  <a
                    className="font-semibold text-[#153d32] hover:underline"
                    href={`/api/documents/${document.id}/download`}
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}
