"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  placeCustomerOrder,
  startTableSession,
  type CustomerActionState,
} from "@/app/m/[slug]/actions";
import { useT } from "@/lib/i18n/client";

const initialState: CustomerActionState = {};

const inputClass =
  "mt-1 block w-full rounded-lg border border-[#d6ded8] bg-white px-3 py-2 text-sm";

function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        Website
        <input autoComplete="off" name="website" tabIndex={-1} type="text" />
      </label>
    </div>
  );
}

export function StartSessionForm({ slug, tables }: { slug: string; tables: string[] }) {
  const [state, action, pending] = useActionState(startTableSession, initialState);
  const { t } = useT();

  return (
    <form action={action} className="relative mt-4 space-y-3">
      <input name="slug" type="hidden" value={slug} />
      <Honeypot />
      <label className="block text-sm font-medium">
        {t("Table number")}
        {tables.length > 0 ? (
          <select className={inputClass} name="tableLabel" required defaultValue="">
            <option disabled value="">
              {t("Select your table")}
            </option>
            {tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={inputClass}
            maxLength={20}
            name="tableLabel"
            placeholder={t("e.g. 12")}
            required
          />
        )}
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-3 py-2 text-sm text-[#9c392d]">
          {state.error}
        </p>
      )}
      <button
        className="rounded-lg bg-[#153d32] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#205443] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? t("Starting...") : t("Start ordering")}
      </button>
    </form>
  );
}

type Category = {
  id: string;
  name: string;
  description: string | null;
  items: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
  }[];
};

export function CustomerOrderForm({
  slug,
  categories,
  currencyCode,
}: {
  slug: string;
  categories: Category[];
  currencyCode: string;
}) {
  const [state, action, pending] = useActionState(placeCustomerOrder, initialState);
  const { t, locale } = useT();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode });

  return (
    <form action={action} className="relative space-y-6">
      <input name="slug" type="hidden" value={slug} />
      <Honeypot />
      {categories.map((category) => (
        <section key={category.id}>
          <h3 className="font-semibold">{category.name}</h3>
          <ul className="mt-2 divide-y divide-[#eef2ef] rounded-xl border border-[#e3e9e4] bg-white">
            {category.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  {item.image_url && (
                    <Image
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover"
                      height={56}
                      src={item.image_url}
                      unoptimized
                      width={56}
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-[#64736a]">{item.description}</p>
                    )}
                    <p className="mt-0.5 text-sm text-[#29483c]">{money.format(Number(item.price))}</p>
                  </div>
                </div>
                <input
                  aria-label={t("Quantity of {name}", { name: item.name })}
                  className="w-20 rounded-lg border border-[#d6ded8] px-2 py-1.5 text-sm"
                  defaultValue={0}
                  max={20}
                  min={0}
                  name={`qty_${item.id}`}
                  type="number"
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <label className="block text-sm font-medium">
        {t("Notes (optional)")}
        <textarea className={inputClass} maxLength={300} name="notes" rows={2} />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-3 py-2 text-sm text-[#9c392d]">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="rounded-lg bg-[#e8f4ee] px-3 py-2 text-sm text-[#153d32]">
          {state.success}
        </p>
      )}
      <button
        className="rounded-lg bg-[#153d32] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#205443] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? t("Sending...") : t("Send order")}
      </button>
    </form>
  );
}
