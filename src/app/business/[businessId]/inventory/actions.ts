"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type InventoryActionState = {
  error?: string;
  success?: string;
  successId?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function businessPath(businessId: string) {
  return `/business/${encodeURIComponent(businessId)}/inventory`;
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

export async function createSupplier(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();

  if (
    !uuidPattern.test(businessId) ||
    name.length < 2 ||
    name.length > 160 ||
    contactName.length > 120 ||
    email.length > 254 ||
    (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
    phone.length > 40
  ) {
    return { error: "Enter valid supplier details." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("create_supplier", {
    p_business_id: businessId,
    p_name: name,
    p_contact_name: contactName || null,
    p_email: email || null,
    p_phone: phone || null,
    p_address: null,
  });

  if (error) {
    console.error("Supplier creation failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "A supplier with this name already exists."
          : "Supplier could not be saved. Check your inventory permissions.",
    };
  }

  revalidatePath(businessPath(businessId));
  return { success: "Supplier added." };
}

export async function createStockItem(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const minimumQuantity = Number(formData.get("minimumQuantity") ?? 0);

  if (
    !uuidPattern.test(businessId) ||
    sku.length < 1 ||
    sku.length > 64 ||
    name.length < 2 ||
    name.length > 160 ||
    unit.length < 1 ||
    unit.length > 32 ||
    !Number.isFinite(minimumQuantity) ||
    minimumQuantity < 0
  ) {
    return { error: "Enter a valid product name, SKU, unit, and minimum quantity." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("create_stock_item", {
    p_business_id: businessId,
    p_sku: sku,
    p_name: name,
    p_unit: unit,
    p_minimum_quantity: minimumQuantity,
  });

  if (error) {
    console.error("Stock item creation failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "That SKU is already in use for this business."
          : "Product could not be created. Check your inventory permissions and details.",
    };
  }

  revalidatePath(businessPath(businessId));
  return { success: "Product added to the inventory catalog." };
}

export async function receiveStock(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const stockItemId = String(formData.get("stockItemId") ?? "");
  const stockLocationId = String(formData.get("stockLocationId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const unitCost = Number(formData.get("unitCost") ?? 0);
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const referenceNumber = String(formData.get("referenceNumber") ?? "").trim();
  const expiresAt = String(formData.get("expiresAt") ?? "");

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(idempotencyKey) ||
    !uuidPattern.test(stockItemId) ||
    !uuidPattern.test(stockLocationId) ||
    (supplierId !== "" && !uuidPattern.test(supplierId)) ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    batchNumber.length > 100 ||
    referenceNumber.length > 100 ||
    (expiresAt !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))
  ) {
    return { error: "Enter valid receipt details." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("receive_stock", {
    p_business_id: businessId,
    p_idempotency_key: idempotencyKey,
    p_stock_item_id: stockItemId,
    p_stock_location_id: stockLocationId,
    p_quantity: quantity,
    p_unit_cost: unitCost,
    p_supplier_id: supplierId || null,
    p_batch_number: batchNumber || null,
    p_expires_at: expiresAt || null,
    p_reference_number: referenceNumber || null,
  });

  if (error) {
    console.error("Stock receipt failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "This receipt was already recorded. Refresh before trying again."
          : "Stock could not be received. Check the selected values, stock expiry, and permissions.",
    };
  }

  revalidatePath(businessPath(businessId));
  return {
    success: "Stock received and recorded in the movement ledger.",
    successId: randomUUID(),
  };
}

export async function requestStock(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "");
  const itemIds = formData.getAll("stockItemIds").map(String);
  const quantities = formData.getAll("quantities").map(String);
  const requestNotes = String(formData.get("requestNotes") ?? "").trim();

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(departmentId) ||
    itemIds.length !== quantities.length ||
    requestNotes.length > 1000
  ) {
    return { error: "Review the department and request details." };
  }

  const items = [];
  for (let index = 0; index < itemIds.length; index += 1) {
    const itemId = itemIds[index];
    const rawQuantity = quantities[index];
    if (!itemId && !rawQuantity) {
      continue;
    }

    const quantity = Number(rawQuantity);
    if (
      !uuidPattern.test(itemId) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return { error: "Each selected product needs a positive quantity." };
    }
    items.push({ stock_item_id: itemId, quantity });
  }

  if (!items.length || new Set(items.map((item) => item.stock_item_id)).size !== items.length) {
    return { error: "Choose at least one product, without duplicates." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("request_stock", {
    p_business_id: businessId,
    p_department_id: departmentId,
    p_items: items,
    p_request_notes: requestNotes || null,
  });

  if (error) {
    console.error("Stock request failed:", error.message);
    return {
      error: "The stock request could not be submitted. Confirm your department access and try again.",
    };
  }

  revalidatePath(businessPath(businessId));
  return { success: "Stock request submitted to the stock manager." };
}

export async function reviewStockRequest(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const businessId = String(formData.get("businessId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const itemIds = formData.getAll("itemIds").map(String);
  const quantities = formData.getAll("approvedQuantities").map(String);
  const notes = String(formData.get("reviewNotes") ?? "").trim();

  if (
    !uuidPattern.test(requestId) ||
    !uuidPattern.test(businessId) ||
    !["approve", "reject"].includes(decision) ||
    notes.length > 1000 ||
    (decision === "approve" &&
      (itemIds.length === 0 || itemIds.length !== quantities.length))
  ) {
    return { error: "Review details are invalid." };
  }

  const approvedItems = [];
  if (decision === "approve") {
    for (let index = 0; index < itemIds.length; index += 1) {
      const quantity = Number(quantities[index]);
      if (!uuidPattern.test(itemIds[index]) || !Number.isFinite(quantity) || quantity < 0) {
        return { error: "Approved quantities must be zero or greater." };
      }
      approvedItems.push({ item_id: itemIds[index], approved_quantity: quantity });
    }
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("review_stock_request", {
    p_request_id: requestId,
    p_approved_items: approvedItems,
    p_reject: decision === "reject",
    p_review_notes: notes || null,
  });

  if (error) {
    console.error("Stock request review failed:", error.message);
    return {
      error:
        error.code === "42501"
          ? "You cannot review your own request."
          : "The request could not be reviewed. It may have already been handled.",
    };
  }

  revalidatePath(businessPath(businessId));
  return { success: "Stock request review saved." };
}

export async function issueStockRequest(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const businessId = String(formData.get("businessId") ?? "");
  const itemIds = formData.getAll("itemIds").map(String);
  const quantities = formData.getAll("issuedQuantities").map(String);

  if (
    !uuidPattern.test(requestId) ||
    !uuidPattern.test(businessId) ||
    itemIds.length === 0 ||
    itemIds.length !== quantities.length
  ) {
    return { error: "Issuance details are invalid." };
  }

  const issuedItems = [];
  for (let index = 0; index < itemIds.length; index += 1) {
    const quantity = Number(quantities[index]);
    if (!uuidPattern.test(itemIds[index]) || !Number.isFinite(quantity) || quantity < 0) {
      return { error: "Issued quantities must be zero or greater." };
    }
    issuedItems.push({ item_id: itemIds[index], issued_quantity: quantity });
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("issue_stock_request", {
    p_request_id: requestId,
    p_issued_items: issuedItems,
  });

  if (error) {
    console.error("Stock request issuance failed:", error.message);
    return {
      error:
        error.code === "23514"
          ? "There is not enough eligible central stock to issue these quantities."
          : "The approved request could not be issued. Verify its status and quantities.",
    };
  }

  revalidatePath(businessPath(businessId));
  return { success: "Stock issued; central and department balances were updated." };
}

export async function adjustStock(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const stockItemId = String(formData.get("stockItemId") ?? "");
  const stockLocationId = String(formData.get("stockLocationId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  const isWastage = formData.get("isWastage") === "on";

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(stockItemId) ||
    !uuidPattern.test(stockLocationId) ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    reason.length < 3 ||
    reason.length > 500 ||
    !["increase", "decrease"].includes(direction) ||
    (isWastage && direction !== "decrease")
  ) {
    return { error: "Enter a valid adjustment amount, direction, and reason." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_business_id: businessId,
    p_stock_item_id: stockItemId,
    p_stock_location_id: stockLocationId,
    p_quantity_delta: direction === "increase" ? quantity : -quantity,
    p_reason: reason,
    p_is_wastage: isWastage,
  });

  if (error) {
    console.error("Stock adjustment failed:", error.message);
    return {
      error:
        error.code === "23514"
          ? "The adjustment cannot reduce inventory below available stock."
          : "The adjustment could not be recorded. Check your permissions and details.",
    };
  }

  revalidatePath(businessPath(businessId));
  return { success: "Adjustment recorded in the stock movement ledger." };
}
