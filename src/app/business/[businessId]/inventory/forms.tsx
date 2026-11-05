"use client";

import { useActionState } from "react";
import {
  adjustStock,
  createStockItem,
  createSupplier,
  issueStockRequest,
  receiveStock,
  requestStock,
  reviewStockRequest,
  type InventoryActionState,
} from "@/app/business/[businessId]/inventory/actions";

type StockItemOption = {
  id: string;
  name: string;
  sku: string;
  unit: string;
};

type StockLocationOption = {
  id: string;
  name: string;
  location_type: "central" | "department";
};

type SupplierOption = {
  id: string;
  name: string;
};

type RequestItemOption = {
  id: string;
  itemName: string;
  sku: string;
  unit: string;
  requestedQuantity: number;
  approvedQuantity: number;
  issuedQuantity: number;
};

type RequestOption = {
  id: string;
  status: string;
  createdAt: string;
  notes: string | null;
  reviewNotes: string | null;
  departmentName: string;
  requesterName: string;
  items: RequestItemOption[];
};

const initialState: InventoryActionState = {};
const inputClass = "form-input";
const buttonClass =
  "rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#205443] disabled:cursor-wait disabled:opacity-60";

function ActionMessage({ state }: { state: InventoryActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mb-4 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="mb-4 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
        {state.success}
      </p>
    );
  }
  return null;
}

function RequestStockForm({
  businessId,
  departments,
  items,
}: {
  businessId: string;
  departments: Array<{ id: string; name: string }>;
  items: StockItemOption[];
}) {
  const [state, formAction, pending] = useActionState(requestStock, initialState);

  return (
    <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
      <h2 className="text-lg font-semibold">Request department stock</h2>
      <p className="mt-1 text-sm leading-6 text-[#64736a]">
        Choose your assigned department and specify requested quantities. A stock manager must review before issue.
      </p>
      <div className="mt-5">
        <ActionMessage state={state} />
      </div>
      <form action={formAction} className="mt-4 space-y-4">
        <input name="businessId" type="hidden" value={businessId} />
        <label className="block text-sm font-medium text-[#33463a]">
          Requesting department
          <select className={inputClass} defaultValue="" name="departmentId" required>
            <option disabled value="">
              Select your department
            </option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-3">
          <p className="text-sm font-medium text-[#33463a]">Requested items</p>
          {Array.from({ length: 5 }, (_, index) => (
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]" key={index}>
              <label className="sr-only" htmlFor={`request-item-${index}`}>
                Product {index + 1}
              </label>
              <select
                className={inputClass}
                defaultValue=""
                id={`request-item-${index}`}
                name="stockItemIds"
              >
                <option value="">Select a product (optional row)</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.sku}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`request-quantity-${index}`}>
                Quantity {index + 1}
              </label>
              <input
                className={inputClass}
                id={`request-quantity-${index}`}
                min="0"
                name="quantities"
                placeholder="Quantity"
                step="0.001"
                type="number"
              />
            </div>
          ))}
        </div>
        <label className="block text-sm font-medium text-[#33463a]">
          Notes (optional)
          <textarea className={`${inputClass} min-h-20 resize-y`} maxLength={1000} name="requestNotes" />
        </label>
        <button className={buttonClass} disabled={pending}>
          {pending ? "Submitting request..." : "Submit stock request"}
        </button>
      </form>
    </section>
  );
}

function ReviewRequestForm({
  businessId,
  request,
}: {
  businessId: string;
  request: RequestOption;
}) {
  const [reviewState, reviewAction, reviewPending] = useActionState(
    reviewStockRequest,
    initialState,
  );
  const [issueState, issueAction, issuePending] = useActionState(
    issueStockRequest,
    initialState,
  );

  return (
    <article className="rounded-xl border border-[#e3e9e4] p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">{request.departmentName}</h3>
          <p className="mt-1 text-xs text-[#64736a]">
            Requested by {request.requesterName} ·{" "}
            {new Date(request.createdAt).toLocaleString()}
          </p>
          {request.notes && (
            <p className="mt-2 text-sm text-[#53635a]">{request.notes}</p>
          )}
        </div>
        <span className="w-fit rounded-full bg-[#fff5e8] px-3 py-1 text-xs font-semibold capitalize text-[#8a5a21]">
          {request.status.replaceAll("_", " ")}
        </span>
      </div>

      <ul className="mt-4 divide-y divide-[#edf0ed]">
        {request.items.map((item) => (
          <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" key={item.id}>
            <span className="text-sm font-medium">{item.itemName}</span>
            <span className="text-xs text-[#64736a]">
              Requested {item.requestedQuantity} {item.unit}
              {request.status !== "submitted" &&
                ` · Approved ${item.approvedQuantity} ${item.unit}`}
              {["issued", "partially_issued"].includes(request.status) &&
                ` · Issued ${item.issuedQuantity} ${item.unit}`}
            </span>
          </li>
        ))}
      </ul>

      {request.status === "submitted" && (
        <div className="mt-4 border-t border-[#edf0ed] pt-4">
          <ActionMessage state={reviewState} />
          <form action={reviewAction} className="space-y-4">
            <input name="businessId" type="hidden" value={businessId} />
            <input name="requestId" type="hidden" value={request.id} />
            <fieldset>
              <legend className="text-sm font-medium text-[#33463a]">
                Approved quantity per item
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {request.items.map((item) => (
                  <label className="text-xs text-[#53635a]" key={item.id}>
                    {item.itemName} (up to {item.requestedQuantity} {item.unit})
                    <input
                      className={inputClass}
                      defaultValue={item.requestedQuantity}
                      max={item.requestedQuantity}
                      min="0"
                      name="approvedQuantities"
                      step="0.001"
                      type="number"
                    />
                    <input name="itemIds" type="hidden" value={item.id} />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm font-medium text-[#33463a]">
              Review notes (optional)
              <textarea
                className={`${inputClass} min-h-16 resize-y`}
                maxLength={1000}
                name="reviewNotes"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                className={buttonClass}
                disabled={reviewPending}
                name="decision"
                value="approve"
              >
                {reviewPending ? "Saving..." : "Approve quantities"}
              </button>
              <button
                className="rounded-lg border border-[#e8c9c3] px-4 py-2.5 text-sm font-semibold text-[#9c392d] hover:bg-[#fff1ee] disabled:opacity-60"
                disabled={reviewPending}
                name="decision"
                value="reject"
              >
                Reject request
              </button>
            </div>
          </form>
        </div>
      )}

      {["approved", "partially_approved"].includes(request.status) && (
        <div className="mt-4 border-t border-[#edf0ed] pt-4">
          <ActionMessage state={issueState} />
          <form action={issueAction} className="space-y-4">
            <input name="businessId" type="hidden" value={businessId} />
            <input name="requestId" type="hidden" value={request.id} />
            <fieldset>
              <legend className="text-sm font-medium text-[#33463a]">
                Actual quantity issued
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {request.items.map((item) => (
                  <label className="text-xs text-[#53635a]" key={item.id}>
                    {item.itemName} (up to {item.approvedQuantity} {item.unit})
                    <input
                      className={inputClass}
                      defaultValue={item.approvedQuantity}
                      max={item.approvedQuantity}
                      min="0"
                      name="issuedQuantities"
                      step="0.001"
                      type="number"
                    />
                    <input name="itemIds" type="hidden" value={item.id} />
                  </label>
                ))}
              </div>
            </fieldset>
            <button className={buttonClass} disabled={issuePending}>
              {issuePending ? "Issuing stock..." : "Issue to department"}
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

export function InventoryForms({
  businessId,
  canManage,
  canRequest,
  canReview,
  departments,
  items,
  locations,
  requests,
  suppliers,
  receiptIdempotencyKey,
}: {
  businessId: string;
  canManage: boolean;
  canRequest: boolean;
  canReview: boolean;
  departments: Array<{ id: string; name: string }>;
  items: StockItemOption[];
  locations: StockLocationOption[];
  requests: RequestOption[];
  suppliers: SupplierOption[];
  receiptIdempotencyKey: string;
}) {
  const [supplierState, supplierAction, supplierPending] = useActionState(
    createSupplier,
    initialState,
  );
  const [itemState, itemAction, itemPending] = useActionState(
    createStockItem,
    initialState,
  );
  const [receiptState, receiptAction, receiptPending] = useActionState(
    receiveStock,
    initialState,
  );
  const [adjustState, adjustAction, adjustPending] = useActionState(
    adjustStock,
    initialState,
  );
  const idempotencyKey = receiptState.successId ?? receiptIdempotencyKey;

  const centralLocation = locations.find(
    (location) => location.location_type === "central",
  );
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      {canManage && (
        <>
          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Add inventory product</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              Create a product record before receiving or issuing stock.
            </p>
            <div className="mt-5">
              <ActionMessage state={itemState} />
            </div>
            <form action={itemAction} className="mt-4 space-y-4">
              <input name="businessId" type="hidden" value={businessId} />
              <label className="block text-sm font-medium text-[#33463a]">
                Product name
                <input className={inputClass} maxLength={160} minLength={2} name="name" required />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-[#33463a]">
                  SKU
                  <input className={inputClass} maxLength={64} name="sku" required />
                </label>
                <label className="block text-sm font-medium text-[#33463a]">
                  Unit (e.g. kg, bottle)
                  <input className={inputClass} maxLength={32} name="unit" required />
                </label>
              </div>
              <label className="block text-sm font-medium text-[#33463a]">
                Low-stock threshold
                <input
                  className={inputClass}
                  defaultValue="0"
                  min="0"
                  name="minimumQuantity"
                  step="0.001"
                  type="number"
                />
              </label>
              <button className={buttonClass} disabled={itemPending}>
                {itemPending ? "Saving product..." : "Add product"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Register supplier</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              Keep supplier contacts attached to stock receipts.
            </p>
            <div className="mt-5">
              <ActionMessage state={supplierState} />
            </div>
            <form action={supplierAction} className="mt-4 space-y-4">
              <input name="businessId" type="hidden" value={businessId} />
              <label className="block text-sm font-medium text-[#33463a]">
                Supplier name
                <input className={inputClass} maxLength={160} minLength={2} name="name" required />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-[#33463a]">
                  Contact person
                  <input className={inputClass} maxLength={120} name="contactName" />
                </label>
                <label className="block text-sm font-medium text-[#33463a]">
                  Email
                  <input className={inputClass} maxLength={254} name="email" type="email" />
                </label>
              </div>
              <label className="block text-sm font-medium text-[#33463a]">
                Phone
                <input className={inputClass} maxLength={40} name="phone" type="tel" />
              </label>
              <button className={buttonClass} disabled={supplierPending}>
                {supplierPending ? "Saving supplier..." : "Add supplier"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Receive central stock</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              Record each receipt with cost, supplier, batch, and expiry details.
            </p>
            <div className="mt-5">
              <ActionMessage state={receiptState} />
            </div>
            {items.length > 0 && centralLocation ? (
              <form action={receiptAction} className="mt-4 space-y-4">
                <input name="businessId" type="hidden" value={businessId} />
                <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
                <input name="stockLocationId" type="hidden" value={centralLocation.id} />
                <label className="block text-sm font-medium text-[#33463a]">
                  Product
                  <select className={inputClass} defaultValue="" name="stockItemId" required>
                    <option disabled value="">Select a product</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.sku} ({item.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-[#33463a]">
                    Quantity received
                    <input className={inputClass} min="0.001" name="quantity" required step="0.001" type="number" />
                  </label>
                  <label className="block text-sm font-medium text-[#33463a]">
                    Unit cost
                    <input className={inputClass} min="0" name="unitCost" required step="0.01" type="number" />
                  </label>
                </div>
                <label className="block text-sm font-medium text-[#33463a]">
                  Supplier (optional)
                  <select className={inputClass} defaultValue="" name="supplierId">
                    <option value="">Not specified</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-[#33463a]">
                    Batch number (optional)
                    <input className={inputClass} maxLength={100} name="batchNumber" />
                  </label>
                  <label className="block text-sm font-medium text-[#33463a]">
                    Expiry date (optional)
                    <input className={inputClass} name="expiresAt" type="date" />
                  </label>
                </div>
                <label className="block text-sm font-medium text-[#33463a]">
                  Supplier reference (optional)
                  <input className={inputClass} maxLength={100} name="referenceNumber" />
                </label>
                <button className={buttonClass} disabled={receiptPending}>
                  {receiptPending ? "Recording receipt..." : "Receive stock"}
                </button>
              </form>
            ) : (
              <p className="mt-5 rounded-lg bg-[#fff9ed] px-4 py-3 text-sm text-[#765321]">
                Add an inventory product before recording a receipt.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Stock adjustment or wastage</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              Corrections require a reason and create an immutable movement record.
            </p>
            <div className="mt-5">
              <ActionMessage state={adjustState} />
            </div>
            {items.length > 0 && locations.length > 0 ? (
              <form action={adjustAction} className="mt-4 space-y-4">
                <input name="businessId" type="hidden" value={businessId} />
                <label className="block text-sm font-medium text-[#33463a]">
                  Product
                  <select className={inputClass} defaultValue="" name="stockItemId" required>
                    <option disabled value="">Select a product</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-[#33463a]">
                  Stock location
                  <select className={inputClass} defaultValue="" name="stockLocationId" required>
                    <option disabled value="">Select a location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-[#33463a]">
                    Quantity
                    <input className={inputClass} min="0.001" name="quantity" required step="0.001" type="number" />
                  </label>
                  <label className="block text-sm font-medium text-[#33463a]">
                    Direction
                    <select className={inputClass} name="direction" required>
                      <option value="decrease">Decrease</option>
                      <option value="increase">Increase</option>
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm text-[#33463a]">
                  <input className="accent-[#153d32]" name="isWastage" type="checkbox" />
                  Record as wastage
                </label>
                <label className="block text-sm font-medium text-[#33463a]">
                  Reason
                  <textarea className={`${inputClass} min-h-20 resize-y`} maxLength={500} minLength={3} name="reason" required />
                </label>
                <button className={buttonClass} disabled={adjustPending}>
                  {adjustPending ? "Recording adjustment..." : "Record adjustment"}
                </button>
              </form>
            ) : (
              <p className="mt-5 rounded-lg bg-[#fff9ed] px-4 py-3 text-sm text-[#765321]">
                Add an inventory product before adjusting stock.
              </p>
            )}
          </section>
        </>
      )}

      {canRequest && departments.length > 0 && (
        <RequestStockForm
          businessId={businessId}
          departments={departments}
          items={items}
        />
      )}

      {canReview && (
        <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8 xl:col-span-2">
          <h2 className="text-lg font-semibold">Department stock requests</h2>
          <p className="mt-1 text-sm text-[#64736a]">
            Review requested and approved amounts separately, then record the actual quantity issued.
          </p>
          {requests.length ? (
            <div className="mt-5 space-y-4">
              {requests.map((request) => (
                <ReviewRequestForm
                  businessId={businessId}
                  key={request.id}
                  request={request}
                />
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-[#d6ded8] px-5 py-8 text-center text-sm text-[#64736a]">
              No department stock requests yet.
            </p>
          )}
        </section>
      )}

      {canRequest && !canReview && (
        <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8 xl:col-span-2">
          <h2 className="text-lg font-semibold">My stock request history</h2>
          {requests.length ? (
            <ul className="mt-5 divide-y divide-[#edf0ed]">
              {requests.map((request) => (
                <li className="py-4" key={request.id}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">{request.departmentName}</p>
                      <p className="mt-1 text-xs text-[#64736a]">
                        {new Date(request.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="w-fit rounded-full bg-[#f2f4f2] px-3 py-1 text-xs font-semibold capitalize text-[#53635a]">
                      {request.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {request.items.map((item) => (
                      <li className="text-sm text-[#53635a]" key={item.id}>
                        {item.itemName}: requested {item.requestedQuantity} {item.unit}
                        {request.status !== "submitted" &&
                          ` · approved ${item.approvedQuantity} ${item.unit}`}
                        {["issued", "partially_issued"].includes(request.status) &&
                          ` · issued ${item.issuedQuantity} ${item.unit}`}
                      </li>
                    ))}
                  </ul>
                  {request.reviewNotes && (
                    <p className="mt-2 text-sm text-[#64736a]">
                      Review note: {request.reviewNotes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[#64736a]">
              Your department has not submitted a stock request yet.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
