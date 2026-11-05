import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/business/[businessId]/payments/receipt/[orderId]/print-button";

export const instant = false;

type ReceiptPageProps = {
  params: Promise<{ businessId: string; orderId: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata = { title: "Receipt", robots: { index: false } };

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { businessId, orderId } = await params;
  if (!uuidPattern.test(businessId) || !uuidPattern.test(orderId)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { data: canManage } = await supabase.rpc("has_business_permission", {
    p_business_id: businessId,
    p_permission_key: "payments.manage",
  });
  if (!canManage) {
    redirect("/dashboard");
  }

  const [
    { data: business },
    { data: settings },
    { data: order },
    { data: items },
    { data: payments },
    { data: refunds },
  ] = await Promise.all([
    supabase.from("businesses").select("name, location").eq("id", businessId).maybeSingle(),
    supabase
      .from("business_settings")
      .select("currency_code")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id, order_code, table_label, created_at, amount_paid")
      .eq("id", orderId)
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id, item_name, quantity, unit_price, status")
      .eq("order_id", orderId)
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      .order("created_at"),
    supabase
      .from("payments")
      .select("id, amount, method, reference, created_at")
      .eq("order_id", orderId)
      .eq("business_id", businessId)
      .order("created_at"),
    supabase
      .from("refunds")
      .select("id, amount, method, created_at")
      .eq("order_id", orderId)
      .eq("business_id", businessId)
      .order("created_at"),
  ]);

  if (!business || !order) {
    notFound();
  }

  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: settings?.currency_code ?? "UGX",
  });
  const total = (items ?? []).reduce(
    (sum, item) => sum + Number(item.unit_price) * item.quantity,
    0,
  );
  const paid = Number(order.amount_paid);
  const balance = Math.round((total - paid) * 100) / 100;

  return (
    <main className="mx-auto max-w-sm bg-white px-5 py-8 text-sm text-black">
      <div className="text-center">
        <h1 className="text-lg font-semibold">{business.name}</h1>
        {business.location && <p className="text-xs">{business.location}</p>}
        <p className="mt-2 text-xs">
          Receipt · {order.order_code} · Table {order.table_label}
        </p>
        <p className="text-xs">{new Date(order.created_at).toLocaleString()}</p>
      </div>

      <ul className="mt-4 divide-y divide-dashed divide-gray-300 border-y border-dashed border-gray-300">
        {(items ?? []).map((item) => (
          <li className="flex justify-between gap-3 py-1.5" key={item.id}>
            <span>
              {item.quantity} × {item.item_name}
            </span>
            <span>{money.format(Number(item.unit_price) * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1">
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd>{money.format(total)}</dd>
        </div>
        {(payments ?? []).map((payment) => (
          <div className="flex justify-between text-xs" key={payment.id}>
            <dt className="capitalize">Paid · {payment.method.replaceAll("_", " ")}</dt>
            <dd>{money.format(Number(payment.amount))}</dd>
          </div>
        ))}
        {(refunds ?? []).map((refund) => (
          <div className="flex justify-between text-xs" key={refund.id}>
            <dt className="capitalize">Refund · {refund.method.replaceAll("_", " ")}</dt>
            <dd>-{money.format(Number(refund.amount))}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-gray-300 pt-1 font-semibold">
          <dt>{balance > 0 ? "Balance due" : "Balance"}</dt>
          <dd>{money.format(Math.max(balance, 0))}</dd>
        </div>
      </dl>

      <p className="mt-6 text-center text-xs">Thank you for visiting.</p>
      <div className="mt-6 flex justify-center">
        <PrintButton />
      </div>
    </main>
  );
}
