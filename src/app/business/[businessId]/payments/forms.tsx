"use client";

import { useActionState } from "react";
import {
  closeCashierShift,
  recordPayment,
  recordRefund,
  requestMobileMoney,
  type PaymentActionState,
} from "@/app/business/[businessId]/payments/actions";

const initialState: PaymentActionState = {};
const inputClass = "form-input";

// The server renders a fresh idempotency key each time the page data changes,
// so a retried submission reuses its key while a new payment gets a new one.
export function PaymentForm({
  businessId,
  orderId,
  due,
  idempotencyKey,
}: {
  businessId: string;
  orderId: string;
  due: number;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(recordPayment, initialState);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input name="businessId" type="hidden" value={businessId} />
      <input name="orderId" type="hidden" value={orderId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-3 py-2 text-xs text-[#9c392d]">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-lg bg-[#edf6ef] px-3 py-2 text-xs text-[#285c3e]">
          {state.success}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          aria-label="Amount"
          className={inputClass}
          defaultValue={due.toFixed(2)}
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
        <select aria-label="Method" className={inputClass} defaultValue="cash" name="method">
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile money</option>
          <option value="card">Card</option>
          <option value="bank_transfer">Bank transfer</option>
        </select>
        <input
          aria-label="Reference"
          className={inputClass}
          maxLength={100}
          name="reference"
          placeholder="Reference (non-cash)"
        />
      </div>
      <button
        className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Recording..." : "Record payment"}
      </button>
    </form>
  );
}

export function RefundForm({
  businessId,
  orderId,
  refundable,
  idempotencyKey,
}: {
  businessId: string;
  orderId: string;
  refundable: number;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(recordRefund, initialState);

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-lg bg-[#f7f8f6] p-3">
      <input name="businessId" type="hidden" value={businessId} />
      <input name="orderId" type="hidden" value={orderId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-3 py-2 text-xs text-[#9c392d]">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-lg bg-[#edf6ef] px-3 py-2 text-xs text-[#285c3e]">
          {state.success}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          aria-label="Refund amount"
          className={inputClass}
          defaultValue={refundable.toFixed(2)}
          max={refundable.toFixed(2)}
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
        <select aria-label="Refund method" className={inputClass} defaultValue="cash" name="method">
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile money</option>
          <option value="card">Card</option>
          <option value="bank_transfer">Bank transfer</option>
        </select>
        <input
          aria-label="Reference"
          className={inputClass}
          maxLength={100}
          name="reference"
          placeholder="Reference (optional)"
        />
      </div>
      <input
        aria-label="Reason"
        className={inputClass}
        maxLength={300}
        minLength={3}
        name="reason"
        placeholder="Reason for refund"
        required
      />
      <button
        className="rounded-lg bg-[#9c392d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#832f25] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Recording..." : "Record refund"}
      </button>
    </form>
  );
}

export function CloseShiftForm({
  businessId,
  expected,
}: {
  businessId: string;
  expected: number;
}) {
  const [state, formAction, pending] = useActionState(closeCashierShift, initialState);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input name="businessId" type="hidden" value={businessId} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-3 py-2 text-xs text-[#9c392d]">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-lg bg-[#edf6ef] px-3 py-2 text-xs text-[#285c3e]">
          {state.success}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          aria-label="Cash counted in drawer"
          className={inputClass}
          defaultValue={expected.toFixed(2)}
          min="0"
          name="counted"
          required
          step="0.01"
          type="number"
        />
        <input
          aria-label="Notes"
          className={inputClass}
          maxLength={300}
          name="notes"
          placeholder="Notes (required if different)"
        />
      </div>
      <button
        className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Closing..." : "Close my shift"}
      </button>
    </form>
  );
}

export function MobileMoneyForm({
  businessId,
  orderId,
  due,
  idempotencyKey,
  mtnEnabled,
  airtelEnabled,
}: {
  businessId: string;
  orderId: string;
  due: number;
  idempotencyKey: string;
  mtnEnabled: boolean;
  airtelEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(requestMobileMoney, initialState);

  if (!mtnEnabled && !airtelEnabled) {
    return (
      <p className="mt-3 text-xs text-[#64736a]">
        Mobile money prompts are unavailable until provider credentials are configured.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-lg bg-[#f7f8f6] p-3">
      <p className="text-xs font-semibold text-[#29483c]">Request mobile money payment</p>
      <input name="businessId" type="hidden" value={businessId} />
      <input name="orderId" type="hidden" value={orderId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-3 py-2 text-xs text-[#9c392d]">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-lg bg-[#edf6ef] px-3 py-2 text-xs text-[#285c3e]">
          {state.success}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          aria-label="Amount"
          className={inputClass}
          defaultValue={due.toFixed(2)}
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
        <select aria-label="Provider" className={inputClass} name="provider">
          {mtnEnabled && <option value="mtn_momo">MTN MoMo</option>}
          {airtelEnabled && <option value="airtel_money">Airtel Money</option>}
        </select>
        <input
          aria-label="Customer phone"
          autoComplete="off"
          className={inputClass}
          inputMode="tel"
          name="phone"
          placeholder="2567XXXXXXXX"
          required
        />
      </div>
      <button
        className="rounded-lg bg-[#a46f38] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8f5f2f] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Sending..." : "Send payment prompt"}
      </button>
    </form>
  );
}