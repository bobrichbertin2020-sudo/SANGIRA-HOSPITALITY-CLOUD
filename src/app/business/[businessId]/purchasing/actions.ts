"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PurchasingActionState = {
  error?: string;
  success?: string;
  successId?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LINE_COUNT = 6;

function purchasingPath(businessId: string) {
  return `/business/${encodeURIComponent(businessId)}/purchasing`;
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/sign-in");
  }

  return supabase;
}

function friendlyError(code: string | undefined, fallback: string, message?: string) {
  if (code === "42501") {
    return "You do not have permission to do that.";
  }
  if (code === "22023" && message) {
    return message;
  }
  return fallback;
}

export async function createPurchaseOrder(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (
    !uuidPattern.test(businessId) ||
    (supplierId !== "" && !uuidPattern.test(supplierId)) ||
    notes.length > 500
  ) {
    return { error: "Enter valid purchase order details." };
  }

  const lines: { stock_item_id: string; quantity: number; unit_cost: number }[] = [];
  for (let index = 0; index < LINE_COUNT; index += 1) {
    const stockItemId = String(formData.get(`item${index}`) ?? "");
    const quantityText = String(formData.get(`quantity${index}`) ?? "").trim();
    if (stockItemId === "" && quantityText === "") {
      continue;
    }
    const quantity = Number(quantityText);
    const unitCost = Number(String(formData.get(`cost${index}`) ?? "0") || 0);
    if (
      !uuidPattern.test(stockItemId) ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitCost) ||
      unitCost < 0
    ) {
      return { error: `Check line ${index + 1}: choose a product and a valid quantity and cost.` };
    }
    lines.push({
      stock_item_id: stockItemId,
      quantity: Math.round(quantity * 1000) / 1000,
      unit_cost: Math.round(unitCost * 100) / 100,
    });
  }

  if (lines.length === 0) {
    return { error: "Add at least one product to the purchase order." };
  }
  if (new Set(lines.map((line) => line.stock_item_id)).size !== lines.length) {
    return { error: "Each product can appear only once on an order." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("create_purchase_order", {
    p_business_id: businessId,
    p_supplier_id: supplierId || null,
    p_notes: notes || null,
    p_items: lines,
  });

  if (error) {
    console.error("Purchase order creation failed:", error.message);
    return {
      error: friendlyError(
        error.code,
        "The purchase order could not be created. Confirm the purchasing migration is deployed.",
        error.message,
      ),
    };
  }

  revalidatePath(purchasingPath(businessId));
  return { success: "Purchase order sent for approval." };
}

export async function reviewPurchaseOrder(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const poId = String(formData.get("poId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(poId) ||
    !["approve", "reject"].includes(decision) ||
    reason.length > 300
  ) {
    return { error: "Invalid review request." };
  }
  if (decision === "reject" && reason === "") {
    return { error: "Give a reason when rejecting an order." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("review_purchase_order", {
    p_po_id: poId,
    p_approve: decision === "approve",
    p_reason: reason || null,
  });

  if (error) {
    console.error("Purchase order review failed:", error.message);
    return {
      error: friendlyError(error.code, "The decision could not be saved.", error.message),
    };
  }

  revalidatePath(purchasingPath(businessId));
  return { success: decision === "approve" ? "Order approved." : "Order rejected." };
}

export async function cancelPurchaseOrder(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const poId = String(formData.get("poId") ?? "");

  if (!uuidPattern.test(businessId) || !uuidPattern.test(poId)) {
    return { error: "Invalid request." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("cancel_purchase_order", { p_po_id: poId });

  if (error) {
    console.error("Purchase order cancel failed:", error.message);
    return {
      error: friendlyError(error.code, "The order could not be cancelled.", error.message),
    };
  }

  revalidatePath(purchasingPath(businessId));
  return { success: "Order cancelled." };
}

export async function receivePurchaseItem(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const unitCost = Number(formData.get("unitCost") ?? 0);
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const expiresAt = String(formData.get("expiresAt") ?? "").trim();

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(itemId) ||
    !uuidPattern.test(idempotencyKey) ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    batchNumber.length > 80 ||
    reference.length > 120 ||
    (expiresAt !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))
  ) {
    return { error: "Enter a valid quantity, cost, and dates." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("receive_purchase_item", {
    p_po_item_id: itemId,
    p_idempotency_key: idempotencyKey,
    p_quantity: Math.round(quantity * 1000) / 1000,
    p_unit_cost: Math.round(unitCost * 100) / 100,
    p_batch_number: batchNumber || null,
    p_expires_at: expiresAt || null,
    p_reference_number: reference || null,
  });

  if (error) {
    console.error("Purchase receipt failed:", error.message);
    return {
      error: friendlyError(error.code, "The delivery could not be recorded.", error.message),
    };
  }

  revalidatePath(purchasingPath(businessId));
  revalidatePath(`/business/${encodeURIComponent(businessId)}/inventory`);
  return { success: "Delivery recorded and stock updated.", successId: randomId() };
}

function randomId() {
  return crypto.randomUUID();
}
