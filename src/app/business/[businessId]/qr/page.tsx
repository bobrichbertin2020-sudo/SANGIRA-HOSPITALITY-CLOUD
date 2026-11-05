import Link from "next/link";
import { Logo } from "@/components/logo";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import {
  savePublicProfile,
  saveDiningTables,
  togglePublicOrdering,
} from "@/app/business/[businessId]/qr/actions";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type QrPageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function QrPage({ params, searchParams }: QrPageProps) {
  const { businessId } = await params;
  if (!uuidPattern.test(businessId)) {
    notFound();
  }
  const { notice: rawNotice } = await searchParams;
  const notice = typeof rawNotice === "string" ? rawNotice.slice(0, 200) : null;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const [
    { data: canManage, error: managePermissionError },
    { data: canManagePublicProfile, error: profilePermissionError },
  ] = await Promise.all([
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "business.manage",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "business.profile.manage",
    }),
  ]);
  if (managePermissionError || profilePermissionError) {
    console.error(
      "QR permission check failed:",
      [managePermissionError, profilePermissionError]
        .filter(Boolean)
        .map((error) => error?.message)
        .join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Access could not be verified. Confirm the QR ordering migration is applied.
        </p>
      </main>
    );
  }
  if (!canManage && !canManagePublicProfile) {
    redirect("/dashboard");
  }

  const [{ data: business }, { data: settings }, { data: tables }] = await Promise.all([
    supabase.from("businesses").select("id, name, slug").eq("id", businessId).maybeSingle(),
    supabase
      .from("business_settings")
      .select("public_ordering_enabled, public_description, public_image_url")
      .eq("business_id", businessId)
      .maybeSingle(),
    canManage
      ? supabase
          .from("dining_tables")
          .select("label")
          .eq("business_id", businessId)
          .order("label")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (!business) {
    notFound();
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = (
    process.env.APP_BASE_URL ?? (host ? `${protocol}://${host}` : "")
  ).replace(/\/$/, "");
  const menuUrl = `${baseUrl}/m/${business.slug}`;
  const svg = await QRCode.toString(menuUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
  });
  const orderingEnabled = settings?.public_ordering_enabled ?? true;

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
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {canManage ? "Customer QR ordering" : "Public business profile"}
        </h1>
        <p className="mt-2 text-sm text-[#64736a]">
          This permanent QR code opens your public menu. Customers choose their table and order
          without an account. It never gives access to staff or management pages.
        </p>
        {notice && (
          <p role="alert" className="mt-4 rounded-lg border border-[#f0c9c3] bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {notice}
          </p>
        )}

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
            <div
              aria-label={`QR code for ${business.name}`}
              className="mx-auto w-64 max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
              role="img"
            />
            <p className="mt-3 break-all text-center text-xs text-[#64736a]">{menuUrl}</p>
            {!process.env.APP_BASE_URL && (
              <p className="mt-2 text-center text-xs text-[#7a5a1d]">
                Set APP_BASE_URL to your production domain before printing this code.
              </p>
            )}
          </section>

          <div className="space-y-6">
            {canManagePublicProfile && (
              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Public business profile</h2>
                <p className="mt-1 text-sm text-[#64736a]">
                  Add the description and image customers see while discovering your business.
                  Images must use an HTTPS URL.
                </p>
                <form action={savePublicProfile} className="mt-3 space-y-3">
                  <input name="businessId" type="hidden" value={businessId} />
                  <label className="block text-sm font-medium text-[#33463a]">
                    Public description
                    <textarea
                      className="mt-1 block w-full rounded-lg border border-[#d6ded8] px-3 py-2 text-sm"
                      defaultValue={settings?.public_description ?? ""}
                      maxLength={500}
                      name="description"
                      rows={4}
                    />
                  </label>
                  <label className="block text-sm font-medium text-[#33463a]">
                    Image URL
                    <input
                      className="mt-1 block w-full rounded-lg border border-[#d6ded8] px-3 py-2 text-sm"
                      defaultValue={settings?.public_image_url ?? ""}
                      maxLength={2048}
                      name="imageUrl"
                      placeholder="https://example.com/image.jpg"
                      type="url"
                    />
                  </label>
                  <button className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443]">
                    Save public profile
                  </button>
                </form>
              </section>
            )}

            {canManage && (
              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Online ordering</h2>
                <p className="mt-1 text-sm text-[#64736a]">
                  Currently {orderingEnabled ? "on" : "off"}. Turning it off keeps the menu
                  visible but stops new customer orders.
                </p>
                <form action={togglePublicOrdering} className="mt-3">
                  <input name="businessId" type="hidden" value={businessId} />
                  <input name="enabled" type="hidden" value={orderingEnabled ? "false" : "true"} />
                  <button className="rounded-lg border border-[#d6ded8] px-4 py-2 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                    {orderingEnabled ? "Turn off" : "Turn on"}
                  </button>
                </form>
              </section>
            )}

            {canManage && (
              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Table numbers</h2>
                <p className="mt-1 text-sm text-[#64736a]">
                  One per line. When set, customers must pick from this list. Leave empty to
                  allow any valid table number.
                </p>
                <form action={saveDiningTables} className="mt-3 space-y-3">
                  <input name="businessId" type="hidden" value={businessId} />
                  <textarea
                    className="block w-full rounded-lg border border-[#d6ded8] px-3 py-2 text-sm"
                    defaultValue={(tables ?? []).map((table) => table.label).join("\n")}
                    name="labels"
                    rows={6}
                  />
                  <button className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443]">
                    Save tables
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
