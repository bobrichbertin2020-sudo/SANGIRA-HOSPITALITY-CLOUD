"use client";

import { useActionState } from "react";
import { uploadDocument, type DocumentActionState } from "@/app/documents/actions";

const initialState: DocumentActionState = {};

export function UploadDocumentForm({
  scope,
  ownerId,
  categories,
  suppliers = [],
}: {
  scope: "business" | "application";
  ownerId: string;
  categories: { value: string; label: string }[];
  suppliers?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(uploadDocument, initialState);

  return (
    <form action={action} className="space-y-3 rounded-xl border border-[#e3e9e4] bg-white p-5">
      <input name="scope" type="hidden" value={scope} />
      <input name="ownerId" type="hidden" value={ownerId} />
      <label className="block text-sm font-medium">
        Document type
        <select
          className="mt-1 block w-full rounded-lg border border-[#d6ded8] px-3 py-2 text-sm"
          name="category"
          required
        >
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      {suppliers.length > 0 && (
        <label className="block text-sm font-medium">
          Supplier (invoices and receipts, optional)
          <select
            className="mt-1 block w-full rounded-lg border border-[#d6ded8] px-3 py-2 text-sm"
            defaultValue=""
            name="supplierId"
          >
            <option value="">No supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">
        File (PDF, JPEG, PNG or WebP, up to 10 MB)
        <input
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="mt-1 block w-full text-sm"
          name="file"
          required
          type="file"
        />
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
        className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Uploading..." : "Upload"}
      </button>
    </form>
  );
}
