"use client";

export function PrintButton({ label = "Print receipt" }: { label?: string }) {
  return (
    <button
      className="rounded-lg bg-[#153d32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#205443] print:hidden"
      onClick={() => window.print()}
      type="button"
    >
      {label}
    </button>
  );
}
