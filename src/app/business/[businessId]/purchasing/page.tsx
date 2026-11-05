import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";
import {
  CancelPurchaseOrderForm,
  CreatePurchaseOrderForm,
  ReceivePurchaseItemForm,
  ReviewPurchaseOrderForm,
} from "./forms";

export const instant = false;

type PurchasingPageProps = {
  params: Promise<{ businessId: string }>;
};

const statusLabels: Record<string, { label: string; tone: string }> = {
  pending_approval: { label: "Waiting for approval", tone: "bg-[#fff6e5] text-[#8a5a12]" },
  approved: { label: "Approved - awaiting delivery", tone: "bg-[#edf6ef] text-[#285c3e]" },
  partially_received: { label: "Partly delivered", tone: "bg-[#eaf1fb] text-[#2b4f86]" },
  received: { label: "Fully received", tone: "bg-[#edf6ef] text-[#285c3e]" },
  rejected: { label: "Rejected", tone: "bg-[#fff1ee] text-[#9c392d]" },
  cancelled: { label: "Cancelled", tone: "bg-[#f0f2f0] text-[#64736a]" },
};

const cardClass = "rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8";

export default async function PurchasingPage({ params }: PurchasingPageProps) {
  const { businessId } = await params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      businessId,
    )
  ) {
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

  const [
    { data: canManage, error: manageError },
    { data: canApprove, error: approveError },
    { data: business, error: businessError },
  ] = await Promise.all([
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "inventory.manage",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "purchasing.approve",
    }),
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
  ]);

  if (manageError || approveError || businessError) {
    console.error(
      "Purchasing permission check failed:",
      [manageError, approveError, businessError]
        .filter(Boolean)
        .map((item) => item?.message)
        .join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Purchasing access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }

  if (!business) {
    notFound();
  }
  if (!canManage && !canApprove) {
    redirect("/dashboard");
  }

  const [
    { data: orders, error: ordersError },
    { data: orderItems, error: itemsError },
    { data: stockItems, error: stockItemsError },
    { data: suppliers, error: suppliersError },
  ] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_number, supplier_id, status, notes, decision_reason, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("purchase_order_items")
      .select("id, purchase_order_id, stock_item_id, quantity_ordered, quantity_received, estimated_unit_cost")
      .eq("business_id", businessId),
    supabase
      .from("stock_items")
      .select("id, name, sku, unit")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name"),
  ]);

  const loadError = ordersError ?? itemsError ?? stockItemsError ?? suppliersError;
  if (loadError) {
    console.error("Purchasing data could not be loaded:", loadError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Purchasing data could not be loaded. Confirm the purchasing migration is deployed.
        </p>
      </main>
    );
  }

  const stockMap = new Map((stockItems ?? []).map((item) => [item.id, item]));
  const supplierMap = new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier]));
  const allOrders = orders ?? [];
  const waiting = allOrders.filter((order) => order.status === "pending_approval");
  const awaitingDelivery = allOrders.filter((order) =>
    ["approved", "partially_received"].includes(order.status),
  );
  const history = allOrders.filter((order) =>
    ["received", "rejected", "cancelled"].includes(order.status),
  );

  const linesFor = (orderId: string) =>
    (orderItems ?? []).filter((line) => line.purchase_order_id === orderId);

  const orderTotal = (orderId: string) =>
    linesFor(orderId).reduce(
      (sum, line) => sum + Number(line.quantity_ordered) * Number(line.estimated_unit_cost),
      0,
    );

  const renderLines = (orderId: string) => (
    <ul className="mt-3 divide-y divide-[#edf0ed] text-sm">
      {linesFor(orderId).map((line) => {
        const stock = stockMap.get(line.stock_item_id);
        return (
          <li className="flex justify-between gap-3 py-1.5" key={line.id}>
            <span>{stock?.name ?? "Product"}</span>
            <span className="text-[#64736a]">
              {Number(line.quantity_received).toLocaleString()} /{" "}
              {Number(line.quantity_ordered).toLocaleString()} {stock?.unit}
            </span>
          </li>
        );
      })}
    </ul>
  );

  const renderHeader = (order: (typeof allOrders)[number]) => {
    const status = statusLabels[order.status];
    return (
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{order.po_number}</p>
          <p className="mt-0.5 text-xs text-[#64736a]">
            {order.supplier_id
              ? (supplierMap.get(order.supplier_id)?.name ?? "Supplier")
              : "No supplier chosen"}{" "}
            · {new Date(order.created_at).toLocaleDateString()} · est.{" "}
            {orderTotal(order.id).toLocaleString()}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status?.tone ?? ""}`}>
          {status?.label ?? order.status}
        </span>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
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
      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        <Link href={`/business/${businessId}/inventory`} className="text-sm font-semibold text-[#153d32]">
          ← Inventory
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          Purchasing
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          Raise a purchase order, get it approved, then record what the supplier actually
          delivered. Received stock goes straight into central inventory.
        </p>

        <div className="mt-8 grid gap-8 xl:grid-cols-2">
          {canApprove && (
            <div className={cardClass}>
              <h2 className="text-lg font-semibold">Waiting for your approval</h2>
              {waiting.length ? (
                <ul className="mt-4 space-y-5">
                  {waiting.map((order) => (
                    <li className="rounded-xl border border-[#e3e9e4] p-4" key={order.id}>
                      {renderHeader(order)}
                      {renderLines(order.id)}
                      {order.notes && (
                        <p className="mt-2 text-xs text-[#64736a]">Note: {order.notes}</p>
                      )}
                      <ReviewPurchaseOrderForm businessId={businessId} poId={order.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#64736a]">Nothing is waiting for approval.</p>
              )}
            </div>
          )}

          {canManage && (
            <div className={cardClass}>
              <h2 className="text-lg font-semibold">New purchase order</h2>
              <p className="mt-1 text-sm text-[#64736a]">
                List what you need to buy. An owner or manager approves it before you order.
              </p>
              {(stockItems ?? []).length ? (
                <CreatePurchaseOrderForm
                  businessId={businessId}
                  items={stockItems ?? []}
                  suppliers={suppliers ?? []}
                />
              ) : (
                <p className="mt-3 text-sm text-[#64736a]">
                  Add products in Inventory before creating a purchase order.
                </p>
              )}
            </div>
          )}
        </div>

        <div className={`${cardClass} mt-8`}>
          <h2 className="text-lg font-semibold">Approved - waiting for delivery</h2>
          {awaitingDelivery.length ? (
            <ul className="mt-4 space-y-5">
              {awaitingDelivery.map((order) => (
                <li className="rounded-xl border border-[#e3e9e4] p-4" key={order.id}>
                  {renderHeader(order)}
                  {canManage ? (
                    <div className="mt-3 space-y-4">
                      {linesFor(order.id)
                        .filter((line) => Number(line.quantity_received) < Number(line.quantity_ordered))
                        .map((line) => {
                          const stock = stockMap.get(line.stock_item_id);
                          const remaining =
                            Number(line.quantity_ordered) - Number(line.quantity_received);
                          return (
                            <div key={line.id}>
                              <p className="text-sm font-medium">
                                {stock?.name ?? "Product"}{" "}
                                <span className="font-normal text-[#64736a]">
                                  · {remaining.toLocaleString()} {stock?.unit} still to receive
                                </span>
                              </p>
                              <ReceivePurchaseItemForm
                                businessId={businessId}
                                estimatedCost={Number(line.estimated_unit_cost)}
                                idempotencyKey={randomUUID()}
                                itemId={line.id}
                                reference={order.po_number}
                                remaining={remaining}
                                unit={stock?.unit ?? "unit"}
                              />
                            </div>
                          );
                        })}
                      <CancelPurchaseOrderForm businessId={businessId} poId={order.id} />
                    </div>
                  ) : (
                    renderLines(order.id)
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[#64736a]">No orders are waiting for delivery.</p>
          )}
        </div>

        {canManage && !canApprove && waiting.length > 0 && (
          <div className={`${cardClass} mt-8`}>
            <h2 className="text-lg font-semibold">Your orders waiting for approval</h2>
            <ul className="mt-4 space-y-4">
              {waiting.map((order) => (
                <li className="rounded-xl border border-[#e3e9e4] p-4" key={order.id}>
                  {renderHeader(order)}
                  {renderLines(order.id)}
                  <CancelPurchaseOrderForm businessId={businessId} poId={order.id} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={`${cardClass} mt-8`}>
          <h2 className="text-lg font-semibold">History</h2>
          {history.length ? (
            <ul className="mt-4 space-y-4">
              {history.map((order) => (
                <li className="rounded-xl border border-[#e3e9e4] p-4" key={order.id}>
                  {renderHeader(order)}
                  {renderLines(order.id)}
                  {order.decision_reason && (
                    <p className="mt-2 text-xs text-[#64736a]">Reason: {order.decision_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[#64736a]">No completed orders yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
