"use client";

import { useActionState } from "react";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  receivePurchaseItem,
  reviewPurchaseOrder,
  type PurchasingActionState,
} from "./actions";

const initialState: PurchasingActionState = {};
const inputClass = "form-input";
const buttonClass =
  "rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#205443] disabled:cursor-wait disabled:opacity-60";
const LINE_COUNT = 6;

function Message({ state }: { state: PurchasingActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mb-3 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="mb-3 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
        {state.success}
      </p>
    );
  }
  return null;
}

export function CreatePurchaseOrderForm({
  businessId,
  items,
  suppliers,
}: {
  businessId: string;
  items: { id: string; name: string; sku: string; unit: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createPurchaseOrder, initialState);

  return (
    <form action={action} className="mt-4 space-y-4">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <label className="block text-sm font-medium text-[#33463a]">
        Supplier (optional)
        <select className={inputClass} defaultValue="" name="supplierId">
          <option value="">Not decided yet</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-3">
        {Array.from({ length: LINE_COUNT }, (_, index) => (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]" key={index}>
            <select
              aria-label={`Product ${index + 1}`}
              className={inputClass}
              defaultValue=""
              name={`item${index}`}
            >
              <option value="">{index === 0 ? "Select a product" : "Another product (optional)"}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.sku} ({item.unit})
                </option>
              ))}
            </select>
            <input
              aria-label={`Quantity ${index + 1}`}
              className={inputClass}
              min="0.001"
              name={`quantity${index}`}
              placeholder="Quantity"
              step="0.001"
              type="number"
            />
            <input
              aria-label={`Estimated unit cost ${index + 1}`}
              className={inputClass}
              min="0"
              name={`cost${index}`}
              placeholder="Est. unit cost"
              step="0.01"
              type="number"
            />
          </div>
        ))}
      </div>
      <label className="block text-sm font-medium text-[#33463a]">
        Notes (optional)
        <textarea className={inputClass} maxLength={500} name="notes" rows={2} />
      </label>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Sending..." : "Send for approval"}
      </button>
    </form>
  );
}

export function ReviewPurchaseOrderForm({
  businessId,
  poId,
}: {
  businessId: string;
  poId: string;
}) {
  const [state, action, pending] = useActionState(reviewPurchaseOrder, initialState);

  return (
    <form action={action} className="mt-3 space-y-2">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <input name="poId" type="hidden" value={poId} />
      <input
        aria-label="Reason (required to reject)"
        className={inputClass}
        maxLength={300}
        name="reason"
        placeholder="Reason (required to reject)"
      />
      <div className="flex gap-2">
        <button
          className={buttonClass}
          disabled={pending}
          name="decision"
          type="submit"
          value="approve"
        >
          Approve
        </button>
        <button
          className="rounded-lg border border-[#e3b9b2] px-4 py-2.5 text-sm font-semibold text-[#9c392d] hover:bg-[#fff1ee] disabled:opacity-60"
          disabled={pending}
          name="decision"
          type="submit"
          value="reject"
        >
          Reject
        </button>
      </div>
    </form>
  );
}

export function CancelPurchaseOrderForm({
  businessId,
  poId,
}: {
  businessId: string;
  poId: string;
}) {
  const [state, action, pending] = useActionState(cancelPurchaseOrder, initialState);

  return (
    <form action={action} className="mt-3">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <input name="poId" type="hidden" value={poId} />
      <button
        className="text-sm font-semibold text-[#9c392d] hover:underline disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Cancelling..." : "Cancel order"}
      </button>
    </form>
  );
}

export function ReceivePurchaseItemForm({
  businessId,
  itemId,
  idempotencyKey,
  remaining,
  unit,
  estimatedCost,
  reference,
}: {
  businessId: string;
  itemId: string;
  idempotencyKey: string;
  remaining: number;
  unit: string;
  estimatedCost: number;
  reference: string;
}) {
  const [state, action, pending] = useActionState(receivePurchaseItem, initialState);
  const key = state.successId ?? idempotencyKey;

  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-[#f7f8f6] p-3">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <input name="itemId" type="hidden" value={itemId} />
      <input name="idempotencyKey" type="hidden" value={key} />
      <div className="grid gap-2 sm:grid-cols-4">
        <input
          aria-label={`Quantity received (${unit})`}
          className={inputClass}
          defaultValue={remaining}
          max={remaining}
          min="0.001"
          name="quantity"
          required
          step="0.001"
          type="number"
        />
        <input
          aria-label="Actual unit cost"
          className={inputClass}
          defaultValue={estimatedCost}
          min="0"
          name="unitCost"
          required
          step="0.01"
          type="number"
        />
        <input
          aria-label="Batch number"
          className={inputClass}
          maxLength={80}
          name="batchNumber"
          placeholder="Batch no."
        />
        <input aria-label="Expiry date" className={inputClass} name="expiresAt" type="date" />
      </div>
      <input
        aria-label="Supplier invoice or delivery note"
        className={inputClass}
        defaultValue={reference}
        maxLength={120}
        name="reference"
        placeholder="Invoice / delivery note"
      />
      <button className={buttonClass} disabled={pending}>
        {pending ? "Recording..." : "Record delivery"}
      </button>
    </form>
  );
}
