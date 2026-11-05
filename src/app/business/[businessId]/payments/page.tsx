import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { CloseShiftForm, MobileMoneyForm, PaymentForm, RefundForm } from "@/app/business/[businessId]/payments/forms";
import { refreshPaymentRequest, setPaymentTiming } from "@/app/business/[businessId]/payments/actions";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { isProviderConfigured, PROVIDER_LABELS, type Provider } from "@/lib/payments/providers";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type PaymentsPageProps = {
  params: Promise<{ businessId: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PaymentsPage({ params }: PaymentsPageProps) {
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

  const { data: canManage, error: permissionError } = await supabase.rpc(
    "has_business_permission",
    { p_business_id: businessId, p_permission_key: "payments.manage" },
  );

  if (permissionError) {
    console.error("Payment permission check failed:", permissionError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Payment access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }
  if (!canManage) {
    redirect("/dashboard");
  }

  const [
    { data: business, error: businessError },
    { data: settings },
    { data: orders, error: ordersError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
    { data: requests, error: requestsError },
    { data: paidOrders, error: paidOrdersError },
    { data: shiftSummary },
    { data: closeouts },
    { data: canBusinessManage },
  ] = await Promise.all([
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    supabase
      .from("business_settings")
      .select("currency_code, payment_timing")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id, order_code, table_label, status, amount_paid, created_at")
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("order_items")
      .select("order_id, unit_price, quantity, status")
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      .limit(1000),
    supabase
      .from("payments")
      .select("id, order_id, amount, method, reference, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("payment_requests")
      .select("id, order_id, provider, amount, msisdn_last4, status, failure_reason, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("orders")
      .select("id, order_code, table_label, status, amount_paid")
      .eq("business_id", businessId)
      .gt("amount_paid", 0)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.rpc("cashier_shift_summary", { p_business_id: businessId }),
    supabase
      .from("cashier_closeouts")
      .select("id, cashier_id, expected_cash, counted_cash, variance, notes, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "business.manage",
    }),
  ]);

  if (
    businessError ||
    ordersError ||
    itemsError ||
    paymentsError ||
    requestsError ||
    paidOrdersError
  ) {
    console.error(
      "Payments workspace could not be loaded:",
      [businessError, ordersError, itemsError, paymentsError, requestsError, paidOrdersError]
        .filter(Boolean)
        .map((error) => error?.message)
        .join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Payments could not be loaded. Confirm the payments migration is deployed and refresh.
        </p>
      </main>
    );
  }
  if (!business) {
    notFound();
  }

  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: settings?.currency_code ?? "UGX",
  });
  const totals = new Map<string, number>();
  for (const item of orderItems ?? []) {
    totals.set(
      item.order_id,
      (totals.get(item.order_id) ?? 0) + Number(item.unit_price) * item.quantity,
    );
  }
  const adminReady = isAdminConfigured();
  const summary = shiftSummary as {
    cash_received: number;
    cash_refunded: number;
    expected_cash: number;
    non_cash_total: number;
  } | null;
  const paymentTiming = settings?.payment_timing === "before" ? "before" : "after";
  const mtnEnabled = adminReady && isProviderConfigured("mtn_momo");
  const airtelEnabled = adminReady && isProviderConfigured("airtel_money");
  const pendingOrderIds = new Set(
    (requests ?? []).filter((request) => request.status === "pending").map((request) => request.order_id),
  );
  const orderMap = new Map((orders ?? []).map((order) => [order.id, order]));
  const openOrders = (orders ?? [])
    .map((order) => ({
      ...order,
      total: totals.get(order.id) ?? 0,
      due: Math.round(((totals.get(order.id) ?? 0) - Number(order.amount_paid)) * 100) / 100,
    }))
    .filter((order) => order.due > 0);
  const refundableOrders = (paidOrders ?? [])
    .map((order) => ({
      ...order,
      refundable:
        Math.round((Number(order.amount_paid) - (totals.get(order.id) ?? 0)) * 100) / 100,
    }))
    .filter((order) => order.refundable > 0);

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
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Cashier payments</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          Cash, card and bank payments are entered manually and verified by the cashier. MTN MoMo and
          Airtel Money payments are requested from the customer&apos;s phone and recorded only after the
          provider confirms them.
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">When customers pay</h2>
                <p className="mt-1 text-xs text-[#64736a]">
                  {paymentTiming === "before"
                    ? "Pay first: kitchen and bar cannot start an order until it is paid."
                    : "Pay after: orders are prepared first and paid at the end of the meal."}
                </p>
              </div>
              {canBusinessManage && (
                <form action={setPaymentTiming} className="flex gap-2">
                  <input name="businessId" type="hidden" value={businessId} />
                  <input
                    name="timing"
                    type="hidden"
                    value={paymentTiming === "before" ? "after" : "before"}
                  />
                  <button className="rounded-lg border border-[#d6ded8] px-3 py-2 text-xs font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                    Switch to pay {paymentTiming === "before" ? "after" : "first"}
                  </button>
                </form>
              )}
            </div>
          </section>

          {summary && (
            <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">My shift</h2>
              <p className="mt-1 text-xs text-[#64736a]">
                Totals since you last closed your shift. Count the drawer and close it at the end of
                your shift.
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-[#64736a]">Cash received</dt>
                  <dd className="font-semibold">{money.format(Number(summary.cash_received))}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64736a]">Cash refunded</dt>
                  <dd className="font-semibold">{money.format(Number(summary.cash_refunded))}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64736a]">Expected in drawer</dt>
                  <dd className="font-semibold">{money.format(Number(summary.expected_cash))}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#64736a]">Other methods</dt>
                  <dd className="font-semibold">{money.format(Number(summary.non_cash_total))}</dd>
                </div>
              </dl>
              <CloseShiftForm
                businessId={businessId}
                expected={Number(summary.expected_cash)}
                key={`shift-${summary.expected_cash}-${closeouts?.length ?? 0}`}
              />
              {closeouts && closeouts.length > 0 && (
                <ul className="mt-4 divide-y divide-[#edf0ed] text-xs">
                  {closeouts.map((closeout) => {
                    const variance = Number(closeout.variance);
                    return (
                      <li className="flex flex-wrap justify-between gap-2 py-2" key={closeout.id}>
                        <span className="text-[#64736a]">
                          {new Date(closeout.created_at).toLocaleString()}
                          {closeout.notes ? ` · ${closeout.notes}` : ""}
                        </span>
                        <span>
                          Expected {money.format(Number(closeout.expected_cash))} · Counted{" "}
                          {money.format(Number(closeout.counted_cash))} ·{" "}
                          <span
                            className={
                              variance === 0 ? "text-[#285c3e]" : "font-semibold text-[#9c392d]"
                            }
                          >
                            {variance === 0 ? "Balanced" : `Variance ${money.format(variance)}`}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6">
            <h2 className="text-lg font-semibold">Orders awaiting payment</h2>
            {openOrders.length ? (
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {openOrders.map((order) => (
                  <li className="py-4" key={order.id}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">
                        {order.order_code} · {order.table_label}
                      </p>
                      <p className="text-sm font-semibold">Due {money.format(order.due)}</p>
                    </div>
                    <p className="text-xs text-[#64736a]">
                      Total {money.format(order.total)} · Paid {money.format(Number(order.amount_paid))}
                    </p>
                    <PaymentForm
                      businessId={businessId}
                      due={order.due}
                      idempotencyKey={randomUUID()}
                      key={`${order.id}-${order.amount_paid}`}
                      orderId={order.id}
                    />
                    {pendingOrderIds.has(order.id) ? (
                      <p className="mt-3 text-xs text-[#64736a]">
                        A mobile money request is pending for this order. Refresh its status below.
                      </p>
                    ) : (
                      <MobileMoneyForm
                        airtelEnabled={airtelEnabled}
                        businessId={businessId}
                        due={order.due}
                        idempotencyKey={randomUUID()}
                        key={`mm-${order.id}-${order.amount_paid}-${requests?.length ?? 0}`}
                        mtnEnabled={mtnEnabled}
                        orderId={order.id}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[#64736a]">No orders are awaiting payment.</p>
            )}
          </section>

          {refundableOrders.length > 0 && (
            <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">Refunds due</h2>
              <p className="mt-1 text-xs text-[#64736a]">
                These orders were paid for items that were later cancelled. Refund the customer, then
                record it here.
              </p>
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {refundableOrders.map((order) => (
                  <li className="py-4" key={order.id}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">
                        {order.order_code} · {order.table_label}
                        {order.status === "cancelled" ? " · cancelled" : ""}
                      </p>
                      <p className="text-sm font-semibold">
                        Refundable {money.format(order.refundable)}
                      </p>
                    </div>
                    <RefundForm
                      businessId={businessId}
                      idempotencyKey={randomUUID()}
                      key={`refund-${order.id}-${order.amount_paid}`}
                      orderId={order.id}
                      refundable={order.refundable}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold">Mobile money requests</h2>
            {requests?.length ? (
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {requests.map((request) => (
                  <li className="flex items-center justify-between gap-3 py-3 text-sm" key={request.id}>
                    <div>
                      <p className="font-medium">
                        {money.format(Number(request.amount))} - {PROVIDER_LABELS[request.provider as Provider]}
                      </p>
                      <p className="text-xs text-[#64736a]">
                        {orderMap.get(request.order_id)?.order_code ?? "Order"} - ending {request.msisdn_last4} -{" "}
                        {new Date(request.created_at).toLocaleString()}
                        {request.failure_reason ? ` - ${request.failure_reason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-[#f2f4f2] px-3 py-1 text-xs font-semibold capitalize text-[#53635a]">
                        {request.status}
                      </span>
                      {request.status === "pending" && (
                        <form action={refreshPaymentRequest}>
                          <input name="businessId" type="hidden" value={businessId} />
                          <input name="requestId" type="hidden" value={request.id} />
                          <button className="text-xs font-semibold text-[#153d32] hover:underline">
                            Check status
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[#64736a]">No mobile money requests yet.</p>
            )}
          </section>

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6">
            <h2 className="text-lg font-semibold">Recent payments</h2>
            {payments?.length ? (
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {payments.map((payment) => (
                  <li className="py-3 text-sm" key={payment.id}>
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{money.format(Number(payment.amount))}</span>
                      <span className="capitalize text-[#64736a]">
                        {payment.method.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="text-xs text-[#64736a]">
                      {orderMap.get(payment.order_id)?.order_code ?? "Order"}
                      {payment.reference ? ` · ${payment.reference}` : ""} ·{" "}
                      {new Date(payment.created_at).toLocaleString()}
                      {" · "}
                      <Link
                        className="font-semibold text-[#153d32] hover:underline"
                        href={`/business/${businessId}/payments/receipt/${payment.order_id}`}
                        target="_blank"
                      >
                        Receipt
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[#64736a]">No payments recorded yet.</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
