import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import {
  deliverTableItems,
  resolveServiceRequest,
  takeOverTicket,
  updateOrderItemStatus,
} from "@/app/business/[businessId]/orders/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { PlaceOrderForm } from "@/app/business/[businessId]/orders/forms";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type OrdersPageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const permissionKeys = [
  "orders.place",
  "orders.view",
  "orders.manage",
  "kitchen.prepare",
  "kitchen.manage",
  "bar.prepare",
  "bar.manage",
  "service.confirm",
  "menu.view",
] as const;

function StatusButton({
  businessId,
  itemId,
  status,
  label,
  subtle = false,
}: {
  businessId: string;
  itemId: string;
  status: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <form action={updateOrderItemStatus}>
      <input name="businessId" type="hidden" value={businessId} />
      <input name="itemId" type="hidden" value={itemId} />
      <input name="status" type="hidden" value={status} />
      <button
        className={
          subtle
            ? "rounded-lg border border-[#d6ded8] px-3 py-1.5 text-xs font-semibold text-[#9c392d] hover:bg-[#fff1ee]"
            : "rounded-lg bg-[#153d32] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#205443]"
        }
      >
        {label}
      </button>
    </form>
  );
}

export default async function OrdersPage({ params, searchParams }: OrdersPageProps) {
  const { businessId } = await params;
  const { notice: rawNotice } = await searchParams;
  const notice = typeof rawNotice === "string" ? rawNotice.slice(0, 200) : null;
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

  const permissionResults = await Promise.all(
    permissionKeys.map((key) =>
      supabase.rpc("has_business_permission", {
        p_business_id: businessId,
        p_permission_key: key,
      }),
    ),
  );

  if (permissionResults.some((result) => result.error)) {
    console.error(
      "Order permission check failed:",
      permissionResults.map((result) => result.error?.message).filter(Boolean).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Order access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }

  const can = Object.fromEntries(
    permissionKeys.map((key, index) => [key, Boolean(permissionResults[index].data)]),
  ) as Record<(typeof permissionKeys)[number], boolean>;
  const canPrepare = {
    kitchen: can["kitchen.prepare"] || can["kitchen.manage"],
    bar: can["bar.prepare"] || can["bar.manage"],
  };

  if (!Object.values(can).some(Boolean)) {
    redirect("/dashboard");
  }

  const [
    { data: business, error: businessError },
    { data: menuItems, error: menuError },
    { data: categories },
    { data: settings },
    { data: queueItems, error: queueError },
    { data: orders, error: ordersError },
    { data: serviceRequests },
  ] = await Promise.all([
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    can["orders.place"] && can["menu.view"]
      ? supabase
          .from("menu_items")
          .select("id, name, price, department_key, category_id")
          .eq("business_id", businessId)
          .eq("is_available", true)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    can["orders.place"] && can["menu.view"]
      ? supabase
          .from("menu_categories")
          .select("id, name")
          .eq("business_id", businessId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("business_settings")
      .select("currency_code")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id, order_id, order_code, table_label, item_name, quantity, department_key, status, created_at, assigned_to, assigned_name, started_at")
      .eq("business_id", businessId)
      .in("status", ["pending", "preparing", "ready"])
      .order("created_at")
      .limit(200),
    can["orders.view"]
      ? supabase
          .from("orders")
          .select("id, order_code, table_label, status, total_amount, created_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("service_requests")
      .select("id, table_label, request_type, created_at")
      .eq("business_id", businessId)
      .eq("status", "open")
      .order("created_at")
      .limit(50),
  ]);

  if (businessError || menuError || queueError || ordersError) {
    console.error(
      "Orders workspace could not be loaded:",
      [businessError, menuError, queueError, ordersError]
        .filter(Boolean)
        .map((error) => error?.message)
        .join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Orders could not be loaded. Confirm the orders migration is deployed and refresh.
        </p>
      </main>
    );
  }
  if (!business) {
    notFound();
  }

  const currencyCode = settings?.currency_code ?? "UGX";
  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
  });
  const categoryMap = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const orderOptions = (menuItems ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    departmentKey: item.department_key,
    categoryName: categoryMap.get(item.category_id) ?? "Menu",
  }));

  const queueOrderIds = [...new Set((queueItems ?? []).map((item) => item.order_id))];
  const { data: queueOrders } = queueOrderIds.length
    ? await supabase.from("orders").select("id, notes").in("id", queueOrderIds)
    : { data: [] };
  const notesByOrder = new Map(
    (queueOrders ?? []).filter((order) => order.notes).map((order) => [order.id, order.notes as string]),
  );
  const canManageTickets = can["orders.manage"] || can["kitchen.manage"] || can["bar.manage"];
  // eslint-disable-next-line react-hooks/purity -- request-time snapshot of ticket ages
  const nowMs = Date.now();
  const waitMinutes = (createdAt: string) =>
    Math.max(0, Math.floor((nowMs - new Date(createdAt).getTime()) / 60000));

  const readyByTable = new Map<string, NonNullable<typeof queueItems>>();
  for (const item of queueItems ?? []) {
    if (item.status !== "ready") continue;
    readyByTable.set(item.table_label, [...(readyByTable.get(item.table_label) ?? []), item]);
  }

  const queues = (["kitchen", "bar"] as const).map((key) => ({
    key,
    items: (queueItems ?? []).filter((item) => item.department_key === key),
  }));

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
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Orders and tickets</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          Orders are split into kitchen and bar tickets. Starting a ticket deducts its recipe ingredients from the department&apos;s stock.
        </p>
        {notice && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-[#f0c9c3] bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]"
          >
            {notice}
          </p>
        )}
        <AutoRefresh seconds={10} />
        {serviceRequests && serviceRequests.length > 0 && (
          <section className="mt-6 rounded-2xl border border-[#f0d9b5] bg-[#fff8e8] p-5">
            <h2 className="text-sm font-semibold text-[#7a5a1d]">Guest requests</h2>
            <ul className="mt-3 space-y-2">
              {serviceRequests.map((request) => (
                <li className="flex items-center justify-between gap-3 text-sm" key={request.id}>
                  <span>
                    <span className="font-medium">Table {request.table_label}</span>{" "}
                    {request.request_type === "request_bill" ? "asked for the bill" : "needs a waiter"} ·{" "}
                    <span className="text-[#64736a]">
                      {new Date(request.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                  <form action={resolveServiceRequest}>
                    <input name="businessId" type="hidden" value={businessId} />
                    <input name="requestId" type="hidden" value={request.id} />
                    <button className="rounded-lg bg-[#153d32] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#205443]">
                      Done
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        {can["service.confirm"] && (
          <section className="mt-6 rounded-2xl border border-[#cfe3d6] bg-[#f1f8f3] p-5">
            <h2 className="text-sm font-semibold text-[#153d32]">Ready to serve</h2>
            {readyByTable.size ? (
              <ul className="mt-3 space-y-3">
                {[...readyByTable.entries()].map(([table, items]) => (
                  <li className="rounded-xl bg-white p-4" key={table}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Table {table}</p>
                        <ul className="mt-1 space-y-0.5 text-sm text-[#29483c]">
                          {items.map((item) => (
                            <li key={item.id}>
                              {item.quantity} × {item.item_name}{" "}
                              <span className="text-xs text-[#64736a]">
                                ({item.department_key}, {item.order_code})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <form action={deliverTableItems}>
                        <input name="businessId" type="hidden" value={businessId} />
                        {items.map((item) => (
                          <input key={item.id} name="itemIds" type="hidden" value={item.id} />
                        ))}
                        <button className="rounded-lg bg-[#153d32] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#205443]">
                          Delivered
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#64736a]">Nothing is waiting to be served.</p>
            )}
          </section>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          {can["orders.place"] && (
            <PlaceOrderForm
              businessId={businessId}
              currencyCode={currencyCode}
              items={orderOptions}
            />
          )}

          <div className="space-y-8">
            {queues.map((queue) => (
              <section
                className="rounded-2xl border border-[#e3e9e4] bg-white p-6"
                key={queue.key}
              >
                <h2 className="text-lg font-semibold capitalize">{queue.key} queue</h2>
                {queue.items.length ? (
                  <ul className="mt-4 divide-y divide-[#edf0ed]">
                    {queue.items.map((item) => (
                      <li className="py-3" key={item.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {item.quantity} × {item.item_name}
                            </p>
                            <p className="text-xs text-[#64736a]">
                              {item.order_code} · {item.table_label}
                            </p>
                            {notesByOrder.get(item.order_id) && (
                              <p className="mt-1 rounded bg-[#fff8e8] px-2 py-1 text-xs text-[#7a5a1d]">
                                Note: {notesByOrder.get(item.order_id)}
                              </p>
                            )}
                            {item.assigned_name && item.status === "preparing" && (
                              <p className="mt-1 text-xs text-[#285c3e]">
                                Being prepared by {item.assigned_name}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="rounded-full bg-[#fff5e8] px-2.5 py-1 text-xs font-semibold capitalize text-[#8a5a21]">
                              {item.status}
                            </span>
                            {(() => {
                              const minutes = waitMinutes(item.created_at);
                              return (
                                <span
                                  className={`text-xs font-semibold ${
                                    item.status === "ready"
                                      ? "text-[#64736a]"
                                      : minutes >= 20
                                        ? "text-[#9c392d]"
                                        : minutes >= 10
                                          ? "text-[#a46f38]"
                                          : "text-[#64736a]"
                                  }`}
                                >
                                  {item.status === "ready" ? "Waiting for service · " : ""}
                                  {minutes} min
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.status === "preparing" &&
                            canManageTickets &&
                            item.assigned_to !== user.id && (
                              <form action={takeOverTicket}>
                                <input name="businessId" type="hidden" value={businessId} />
                                <input name="itemId" type="hidden" value={item.id} />
                                <button className="rounded-lg border border-[#d6ded8] px-3 py-1.5 text-xs font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                                  Take over
                                </button>
                              </form>
                            )}
                          {item.status === "pending" && canPrepare[queue.key] && (
                            <StatusButton businessId={businessId} itemId={item.id} label="Start" status="preparing" />
                          )}
                          {item.status === "preparing" && canPrepare[queue.key] && (
                            <StatusButton businessId={businessId} itemId={item.id} label="Mark ready" status="ready" />
                          )}
                          {item.status === "ready" && can["service.confirm"] && (
                            <StatusButton businessId={businessId} itemId={item.id} label="Confirm delivered" status="delivered" />
                          )}
                          {item.status !== "ready" &&
                            (can["orders.manage"] || canPrepare[queue.key]) && (
                              <StatusButton subtle businessId={businessId} itemId={item.id} label="Cancel" status="cancelled" />
                            )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-[#64736a]">No open tickets.</p>
                )}
              </section>
            ))}
          </div>
        </div>

        {can["orders.view"] && (
          <section className="mt-8 rounded-2xl border border-[#e3e9e4] bg-white p-6">
            <h2 className="text-lg font-semibold">Recent orders</h2>
            {orders?.length ? (
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {orders.map((order) => (
                  <li className="flex items-center justify-between gap-3 py-3 text-sm" key={order.id}>
                    <span>
                      <span className="font-medium">{order.order_code}</span> · {order.table_label}
                    </span>
                    <span className="text-[#64736a]">
                      {money.format(Number(order.total_amount))} ·{" "}
                      <span className="capitalize">{order.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[#64736a]">No orders yet.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
