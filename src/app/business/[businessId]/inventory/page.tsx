import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { InventoryForms } from "@/app/business/[businessId]/inventory/forms";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type InventoryPageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

const notices: Record<string, string> = {
  "receipt-recorded": "Stock receipt recorded.",
  "request-submitted": "Stock request submitted.",
};

export default async function InventoryPage({
  params,
  searchParams,
}: InventoryPageProps) {
  const [{ businessId }, { notice, error: pageError }] = await Promise.all([
    params,
    searchParams,
  ]);

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
    { data: canView, error: viewError },
    { data: canManage, error: manageError },
    { data: canReview, error: reviewError },
    { data: business, error: businessError },
    { data: membership, error: membershipError },
  ] = await Promise.all([
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "inventory.view",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "inventory.manage",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "inventory.requests.review",
    }),
    supabase
      .from("businesses")
      .select("id, name")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_memberships")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (viewError || manageError || reviewError || businessError || membershipError) {
    const errors = [
      viewError,
      manageError,
      reviewError,
      businessError,
      membershipError,
    ].filter(Boolean);
    console.error(
      "Inventory permission check failed:",
      errors.map((item) => item?.message).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Inventory access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }

  if (!business) {
    notFound();
  }
  if (!canView && !canManage && !canReview) {
    redirect("/dashboard");
  }

  const [
    { data: allDepartments, error: departmentsError },
    { data: items, error: itemsError },
    { data: locations, error: locationsError },
    { data: balances, error: balancesError },
    { data: suppliers, error: suppliersError },
    { data: receipts, error: receiptsError },
    { data: movements, error: movementsError },
    { data: membershipDepartments, error: membershipDepartmentsError },
    { data: stockRequests, error: requestsError },
  ] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name, department_key")
      .eq("business_id", businessId)
      .eq("is_enabled", true)
      .order("name"),
    canView || canManage
      ? supabase
          .from("stock_items")
          .select("id, name, sku, unit, minimum_quantity, is_active")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    canView || canManage
      ? supabase
          .from("stock_locations")
          .select("id, name, location_type, department_id")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    canView || canManage
      ? supabase
          .from("stock_balances")
          .select("stock_location_id, stock_item_id, quantity")
          .eq("business_id", businessId)
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("suppliers")
          .select("id, name, is_active")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("stock_receipts")
          .select("id, stock_item_id, supplier_id, quantity, unit_cost, reference_number, created_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    canView || canManage
      ? supabase
          .from("stock_movements")
          .select("id, stock_item_id, stock_location_id, movement_type, quantity_delta, reason, created_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    membership?.id
      ? supabase
          .from("membership_departments")
          .select("department_id")
          .eq("membership_id", membership.id)
      : Promise.resolve({ data: [], error: null }),
    canReview || membership?.id
      ? supabase
          .from("stock_requests")
          .select("id, department_id, requested_by, status, request_notes, review_notes, created_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const errors = [
    departmentsError,
    itemsError,
    locationsError,
    balancesError,
    suppliersError,
    receiptsError,
    movementsError,
    membershipDepartmentsError,
    requestsError,
  ].filter(Boolean);

  if (errors.length) {
    console.error(
      "Inventory workspace data could not be loaded:",
      errors.map((item) => item?.message).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Inventory data could not be loaded. Confirm the inventory migration is deployed and refresh the page.
        </p>
      </main>
    );
  }

  const departmentMap = new Map(
    (allDepartments ?? []).map((department) => [department.id, department]),
  );
  const itemMap = new Map(
    (items ?? []).map((item) => [item.id, item]),
  );
  const supplierMap = new Map(
    (suppliers ?? []).map((supplier) => [supplier.id, supplier]),
  );
  const locationMap = new Map(
    (locations ?? []).map((location) => [location.id, location]),
  );
  const balanceRows = balances ?? [];
  const centralLocation = (locations ?? []).find(
    (location) => location.location_type === "central",
  );
  const assignedDepartmentIds = new Set(
    (membershipDepartments ?? []).map((assignment) => assignment.department_id),
  );

  const visibleDepartments = (allDepartments ?? []).filter(
    (department) => assignedDepartmentIds.has(department.id),
  );
  const allowedDepartments: typeof visibleDepartments = [];
  for (const department of visibleDepartments) {
    const { data: allowed, error: departmentPermissionError } = await supabase.rpc(
      "has_department_permission",
      {
        p_business_id: businessId,
        p_department_id: department.id,
        p_permission_key: "inventory.request",
      },
    );

    if (departmentPermissionError) {
      console.error(
        "Department inventory permission check failed:",
        departmentPermissionError.message,
      );
      return (
        <main className="mx-auto max-w-4xl px-5 py-12">
          <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            Department permissions could not be verified. Refresh and try again.
          </p>
        </main>
      );
    }

    if (allowed) {
      allowedDepartments.push(department);
    }
  }

  const canRequest = allowedDepartments.length > 0;
  const requestIds = (stockRequests ?? []).map((request) => request.id);
  const { data: requestItems, error: requestItemsError } = requestIds.length
    ? await supabase
        .from("stock_request_items")
        .select("id, request_id, stock_item_id, requested_quantity, approved_quantity, issued_quantity")
        .in("request_id", requestIds)
    : { data: [], error: null };

  if (requestItemsError) {
    console.error("Stock request items could not be loaded:", requestItemsError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Stock request details could not be loaded.
        </p>
      </main>
    );
  }

  const requests = (stockRequests ?? []).map((request) => ({
    id: request.id,
    status: request.status,
    createdAt: request.created_at,
    notes: request.request_notes,
    reviewNotes: request.review_notes,
    departmentName: departmentMap.get(request.department_id)?.name ?? "Department",
    requesterName: request.requested_by === user.id ? "You" : "Department staff",
    items: (requestItems ?? [])
      .filter((item) => item.request_id === request.id)
      .map((item) => {
        const stockItem = itemMap.get(item.stock_item_id);
        return {
          id: item.id,
          itemName: stockItem?.name ?? "Inventory item",
          sku: stockItem?.sku ?? "",
          unit: stockItem?.unit ?? "unit",
          requestedQuantity: Number(item.requested_quantity),
          approvedQuantity: Number(item.approved_quantity),
          issuedQuantity: Number(item.issued_quantity),
        };
      }),
  }));

  const lowStockCount = balanceRows.filter((balance) => {
    if (balance.stock_location_id !== centralLocation?.id) {
      return false;
    }
    const item = itemMap.get(balance.stock_item_id);
    return item && Number(balance.quantity) <= Number(item.minimum_quantity);
  }).length;

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
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          Inventory operations
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          Receipts, department requests, stock balances, and auditable movements.
        </p>
        {canManage && (
          <Link
            href={`/business/${businessId}/purchasing`}
            className="mt-4 inline-block text-sm font-semibold text-[#153d32] hover:underline"
          >
            Purchase orders →
          </Link>
        )}
        {notice && notices[notice] && (
          <p className="mt-6 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
            {notices[notice]}
          </p>
        )}
        {pageError === "inventory-unavailable" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            The requested inventory operation is unavailable or your access has changed.
          </p>
        )}

        {(canView || canManage) && (
          <section className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[#e3e9e4] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">Products</p>
              <p className="mt-2 text-2xl font-semibold">{items?.length ?? 0}</p>
            </div>
            <div className="rounded-xl border border-[#e3e9e4] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">Low stock</p>
              <p className="mt-2 text-2xl font-semibold">{lowStockCount}</p>
            </div>
            <div className="rounded-xl border border-[#e3e9e4] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">
                Open requests
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {requests.filter((request) =>
                  ["submitted", "approved", "partially_approved"].includes(request.status),
                ).length}
              </p>
            </div>
          </section>
        )}

        {canView && (
          <section className="mt-8 rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Stock by location</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              Each quantity is scoped to the locations your role can access.
            </p>
            {balanceRows.length ? (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#edf0ed] text-xs text-[#85938a]">
                      <th className="py-3 pr-4 font-medium">Product</th>
                      <th className="py-3 pr-4 font-medium">Location</th>
                      <th className="py-3 pr-4 text-right font-medium">Available</th>
                      <th className="py-3 text-right font-medium">Minimum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceRows.map((balance) => {
                      const item = itemMap.get(balance.stock_item_id);
                      const location = locationMap.get(balance.stock_location_id);
                      const quantity = Number(balance.quantity);
                      const isLow =
                        item && quantity <= Number(item.minimum_quantity);
                      return (
                        <tr
                          className="border-b border-[#f0f2f0] last:border-0"
                          key={`${balance.stock_location_id}-${balance.stock_item_id}`}
                        >
                          <td className="py-3 pr-4">
                            <span className="font-medium">{item?.name ?? "Inventory item"}</span>
                            <span className="ml-2 text-xs text-[#85938a]">{item?.sku}</span>
                          </td>
                          <td className="py-3 pr-4">{location?.name ?? "Stock location"}</td>
                          <td className={`py-3 pr-4 text-right font-medium ${isLow ? "text-[#9c392d]" : ""}`}>
                            {quantity.toLocaleString()} {item?.unit}
                          </td>
                          <td className="py-3 text-right text-[#64736a]">
                            {Number(item?.minimum_quantity ?? 0).toLocaleString()} {item?.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-dashed border-[#d6ded8] px-5 py-9 text-center">
                <p className="text-sm font-medium">No stock recorded yet</p>
                <p className="mt-1 text-sm text-[#64736a]">
                  Products and balances appear after the first inventory receipt.
                </p>
              </div>
            )}
          </section>
        )}

        <div className="mt-8">
          <InventoryForms
            businessId={businessId}
            canManage={Boolean(canManage)}
            canRequest={canRequest}
            canReview={Boolean(canReview)}
            departments={allowedDepartments}
            items={(items ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              sku: item.sku,
              unit: item.unit,
            }))}
            locations={(locations ?? []).map((location) => ({
              id: location.id,
              name: location.name,
              location_type: location.location_type,
            }))}
            requests={requests}
            suppliers={(suppliers ?? []).map((supplier) => ({
              id: supplier.id,
              name: supplier.name,
            }))}
            receiptIdempotencyKey={randomUUID()}
          />
        </div>

        {(canManage || canView) && (
          <section className="mt-8 grid gap-8 xl:grid-cols-2">
            {canManage && (
              <div className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
                <h2 className="text-lg font-semibold">Recent receipts</h2>
                {receipts?.length ? (
                  <ul className="mt-4 divide-y divide-[#edf0ed]">
                    {receipts.map((receipt) => (
                      <li className="flex items-start justify-between gap-4 py-3" key={receipt.id}>
                        <div>
                          <p className="text-sm font-medium">
                            {itemMap.get(receipt.stock_item_id)?.name ?? "Inventory item"}
                          </p>
                          <p className="mt-1 text-xs text-[#64736a]">
                            {supplierMap.get(receipt.supplier_id)?.name ?? "Supplier not specified"} ·{" "}
                            {receipt.reference_number ?? "No supplier reference"} ·{" "}
                            {new Date(receipt.created_at).toLocaleString()}
                          </p>
                        </div>
                        <p className="shrink-0 text-right text-sm font-semibold">
                          {Number(receipt.quantity).toLocaleString()}{" "}
                          {itemMap.get(receipt.stock_item_id)?.unit}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-[#64736a]">No receipts recorded yet.</p>
                )}
              </div>
            )}
            {canView && (
              <div className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
                <h2 className="text-lg font-semibold">Recent stock movements</h2>
                {movements?.length ? (
                  <ul className="mt-4 divide-y divide-[#edf0ed]">
                    {movements.map((movement) => {
                      const item = itemMap.get(movement.stock_item_id);
                      const location = locationMap.get(movement.stock_location_id);
                      return (
                        <li className="flex items-start justify-between gap-4 py-3" key={movement.id}>
                          <div>
                            <p className="text-sm font-medium">
                              {item?.name ?? "Inventory item"} · {location?.name ?? "Stock location"}
                            </p>
                            <p className="mt-1 text-xs capitalize text-[#64736a]">
                              {movement.movement_type.replaceAll("_", " ")}
                              {movement.reason ? ` · ${movement.reason}` : ""}
                            </p>
                          </div>
                          <p className={`shrink-0 text-sm font-semibold ${Number(movement.quantity_delta) < 0 ? "text-[#9c392d]" : "text-[#34714d]"}`}>
                            {Number(movement.quantity_delta) > 0 ? "+" : ""}
                            {Number(movement.quantity_delta).toLocaleString()} {item?.unit}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-[#64736a]">No stock movements recorded yet.</p>
                )}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
