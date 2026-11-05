"use client";

import { useActionState } from "react";
import {
  placeOrder,
  type OrderActionState,
} from "@/app/business/[businessId]/orders/actions";

type MenuOption = {
  id: string;
  name: string;
  price: number;
  departmentKey: string;
  categoryName: string;
};

const initialState: OrderActionState = {};
const inputClass = "form-input";

export function PlaceOrderForm({
  businessId,
  items,
  currencyCode,
}: {
  businessId: string;
  items: MenuOption[];
  currencyCode: string;
}) {
  const [state, formAction, pending] = useActionState(placeOrder, initialState);
  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
  });

  return (
    <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
      <h2 className="text-lg font-semibold">New order</h2>
      {state.error && (
        <p role="alert" className="mt-4 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="mt-4 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
          {state.success}
        </p>
      )}
      {!items.length ? (
        <p className="mt-4 text-sm text-[#64736a]">
          No available menu items. Add items in the menu catalog first.
        </p>
      ) : (
        <form action={formAction} className="mt-4 space-y-4">
          <input name="businessId" type="hidden" value={businessId} />
          <label className="block text-sm font-medium text-[#33463a]">
            Table or room
            <input className={inputClass} maxLength={60} name="tableLabel" required />
          </label>
          <ul className="divide-y divide-[#edf0ed]">
            {items.map((item) => (
              <li className="flex items-center justify-between gap-4 py-3" key={item.id}>
                <input name="menuItemIds" type="hidden" value={item.id} />
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-[#64736a]">
                    {item.categoryName} · {money.format(item.price)} · {item.departmentKey}
                  </p>
                </div>
                <input
                  aria-label={`Quantity for ${item.name}`}
                  className="form-input !mt-0 w-20"
                  max={50}
                  min={0}
                  name="quantities"
                  placeholder="0"
                  step={1}
                  type="number"
                />
              </li>
            ))}
          </ul>
          <label className="block text-sm font-medium text-[#33463a]">
            Notes (optional)
            <textarea className={`${inputClass} min-h-16 resize-y`} maxLength={500} name="notes" />
          </label>
          <button
            className="rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#205443] disabled:cursor-wait disabled:opacity-60"
            disabled={pending}
          >
            {pending ? "Sending..." : "Place order"}
          </button>
        </form>
      )}
    </section>
  );
}
