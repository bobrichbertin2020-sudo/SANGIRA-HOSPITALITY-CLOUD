import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type ReportsPageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
};

type Report = {
  sales: { order_count: number; item_count: number; gross_sales: number };
  payments_by_method: { method: string; total: number }[];
  top_items: { name: string; quantity: number; sales: number }[];
  low_stock: { name: string; unit: string; on_hand: number; minimum: number }[];
  expiring_batches: {
    name: string;
    batch_number: string | null;
    expires_at: string;
    remaining: number;
  }[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | string[] | undefined, fallback: string) {
  if (typeof value !== "string" || !datePattern.test(value)) {
    return fallback;
  }
  return Number.isNaN(Date.parse(value)) ? fallback : value;
}

export default async function ReportsPage({ params, searchParams }: ReportsPageProps) {
  const { businessId } = await params;
  if (!uuidPattern.test(businessId)) {
    notFound();
  }

  const query = await searchParams;
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 29 * 86_400_000);
  const to = validDate(query.to, isoDate(today));
  const from = validDate(query.from, isoDate(monthAgo));

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const { data: canView, error: permissionError } = await supabase.rpc(
    "has_business_permission",
    { p_business_id: businessId, p_permission_key: "reports.view" },
  );
  if (permissionError) {
    console.error("Report permission check failed:", permissionError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Report access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }
  if (!canView) {
    redirect("/dashboard");
  }

  const [{ data: business }, { data: settings }, reportResult] = await Promise.all([
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    supabase
      .from("business_settings")
      .select("currency_code")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase.rpc("business_report", {
      p_business_id: businessId,
      p_from: from,
      p_to: to,
    }),
  ]);

  if (!business) {
    notFound();
  }

  const report = reportResult.data as Report | null;
  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: settings?.currency_code ?? "UGX",
  });

  let errorMessage: string | null = null;
  if (reportResult.error) {
    console.error("Report failed:", reportResult.error.message);
    errorMessage =
      reportResult.error.code === "22023"
        ? "Choose a valid date range of at most 366 days."
        : "The report could not be loaded. Confirm the reports migration is deployed.";
  }

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
        <Link className="text-sm font-semibold text-[#153d32] hover:underline" href="/dashboard">
          ← Dashboard
        </Link>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          {business.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          Sales exclude cancelled items. Dates use UTC. Payments are manually recorded entries.
        </p>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">
            From
            <input
              className="mt-1 block rounded-lg border border-[#d6ded8] bg-white px-3 py-2"
              defaultValue={from}
              name="from"
              type="date"
            />
          </label>
          <label className="text-sm font-medium">
            To
            <input
              className="mt-1 block rounded-lg border border-[#d6ded8] bg-white px-3 py-2"
              defaultValue={to}
              name="to"
              type="date"
            />
          </label>
          <button className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443]">
            Update
          </button>
        </form>

        {errorMessage && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {errorMessage}
          </p>
        )}

        {report && (
          <div className="mt-8 space-y-8">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Gross sales", money.format(Number(report.sales.gross_sales))],
                ["Orders", String(report.sales.order_count)],
                ["Items sold", String(report.sales.item_count)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#64736a]">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Payments received</h2>
                <ul className="mt-3 divide-y divide-[#eef2ef] text-sm">
                  {report.payments_by_method.length === 0 && (
                    <li className="py-2 text-[#64736a]">No payments in this period.</li>
                  )}
                  {report.payments_by_method.map((row) => (
                    <li key={row.method} className="flex justify-between py-2">
                      <span className="capitalize">{row.method.replace("_", " ")}</span>
                      <span>{money.format(Number(row.total))}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Top items</h2>
                <ul className="mt-3 divide-y divide-[#eef2ef] text-sm">
                  {report.top_items.length === 0 && (
                    <li className="py-2 text-[#64736a]">No sales in this period.</li>
                  )}
                  {report.top_items.map((row) => (
                    <li key={row.name} className="flex justify-between py-2">
                      <span>
                        {row.name} × {row.quantity}
                      </span>
                      <span>{money.format(Number(row.sales))}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Low stock</h2>
                <ul className="mt-3 divide-y divide-[#eef2ef] text-sm">
                  {report.low_stock.length === 0 && (
                    <li className="py-2 text-[#64736a]">Nothing at or below its minimum.</li>
                  )}
                  {report.low_stock.map((row) => (
                    <li key={row.name} className="flex justify-between py-2">
                      <span>{row.name}</span>
                      <span>
                        {row.on_hand} / min {row.minimum} {row.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border border-[#e3e9e4] bg-white p-5">
                <h2 className="font-semibold">Expiring within 14 days</h2>
                <ul className="mt-3 divide-y divide-[#eef2ef] text-sm">
                  {report.expiring_batches.length === 0 && (
                    <li className="py-2 text-[#64736a]">No batches expiring soon.</li>
                  )}
                  {report.expiring_batches.map((row, index) => (
                    <li key={`${row.name}-${row.batch_number ?? ""}-${index}`} className="flex justify-between py-2">
                      <span>
                        {row.name}
                        {row.batch_number ? ` (${row.batch_number})` : ""}
                      </span>
                      <span>
                        {row.remaining} · {row.expires_at}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
