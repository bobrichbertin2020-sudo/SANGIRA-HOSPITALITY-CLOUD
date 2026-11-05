"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  MAX_DOCUMENT_BYTES,
  detectFileType,
  documentCategories,
  safeDisplayName,
  type DocumentCategory,
} from "@/lib/documents/files";
import { createClient } from "@/lib/supabase/server";

export type DocumentActionState = {
  error?: string;
  success?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function uploadDocument(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const scope = String(formData.get("scope") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");
  const category = String(formData.get("category") ?? "") as DocumentCategory;
  const supplierId = String(formData.get("supplierId") ?? "");
  const file = formData.get("file");

  if (
    (scope !== "business" && scope !== "application") ||
    !uuidPattern.test(ownerId) ||
    !documentCategories.includes(category) ||
    (supplierId !== "" && !uuidPattern.test(supplierId)) ||
    (scope === "application" && !["registration", "verification"].includes(category)) ||
    (supplierId !== "" && !["supplier_invoice", "receipt"].includes(category))
  ) {
    return { error: "Choose a document type and a file." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "Files can be at most 10 MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFileType(bytes);
  if (!detected) {
    return { error: "Only PDF, JPEG, PNG or WebP files are accepted." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const path = `${scope === "business" ? "b" : "a"}/${ownerId}/${category}/${randomUUID()}.${detected.ext}`;
  const { error: uploadError } = await supabase.storage
    .from("sangira-documents")
    .upload(path, bytes, { contentType: detected.mime, upsert: false });

  if (uploadError) {
    console.error("Document upload failed:", uploadError.message);
    return { error: "You are not allowed to upload this document, or the upload failed." };
  }

  const { error: registerError } = await supabase.rpc("register_document", {
    p_storage_path: path,
    p_original_name: safeDisplayName(file.name),
    p_supplier_id: supplierId || null,
  });
  if (registerError) {
    console.error("Document registration failed:", registerError.message);
    return { error: "The file was uploaded but could not be recorded. Please try again." };
  }

  revalidatePath(
    scope === "business" ? `/business/${ownerId}/documents` : "/business/apply/documents",
  );
  return { success: "Document uploaded." };
}
