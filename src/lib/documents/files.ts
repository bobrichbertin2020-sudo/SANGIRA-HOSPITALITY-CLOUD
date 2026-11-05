import "server-only";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const documentCategories = [
  "registration",
  "verification",
  "supplier_invoice",
  "receipt",
] as const;
export type DocumentCategory = (typeof documentCategories)[number];

export const categoryLabels: Record<DocumentCategory, string> = {
  registration: "Business registration",
  verification: "Verification",
  supplier_invoice: "Supplier invoice",
  receipt: "Receipt",
};

type Detected = { mime: string; ext: string };

// The file type is determined from the file's own bytes; the browser-supplied
// type and extension are never trusted.
export function detectFileType(bytes: Uint8Array): Detected | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    return { mime: "application/pdf", ext: "pdf" };
  }
  if (startsWith(0xff, 0xd8, 0xff)) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export function safeDisplayName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "_").trim().slice(0, 120);
  return cleaned || "document";
}
