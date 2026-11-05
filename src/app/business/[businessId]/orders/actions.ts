"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type OrderActionState = {
  error?: string;
  success?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const itemStatuses = ["preparing", "ready", "delivered", "cancelled"] as const;

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

export async function placeOrder(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const tableLabel = String(formData.get("tableLabel") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const menuItemIds = formData.getAll("menuItemIds").map(String);
  const quantities = formData.getAll("quantities").map(String);

  if (
    !uuidPattern.test(businessId) ||
    tableLabel.length < 1 ||
    tableLabel.length > 60 ||
    notes.length > 500 ||
    menuItemIds.length !== quantities.length
  ) {
    return { error: "Enter a table or room and review the order." };
  }

  const items = [];
  for (let index = 0; index < menuItemIds.length; index += 1) {
    const rawQuantity = quantities[index].trim();
    if (rawQuantity === "" || rawQuantity === "0") {
      continue;
    }
    const quantity = Number(rawQuantity);
    if (
      !uuidPattern.test(menuItemIds[index]) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 50
    ) {
      return { error: "Quantities must be whole numbers from 1 to 50." };
    }
    items.push({ menu_item_id: menuItemIds[index], quantity });
  }

  if (!items.length || items.length > 40) {
    return { error: "Add between 1 and 40 menu items to the order." };
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("place_order", {
    p_business_id: businessId,
    p_table_label: tableLabel,
    p_notes: notes || null,
    p_items: items,
  });

  if (error) {
    console.error("Order placement failed:", error.message);
    return {
      error:
        error.code === "42501"
          ? "You do not have permission to place orders."
          : "The order could not be placed. Check the items and try again.",
    };
  }

  revalidatePath(`/business/${businessId}/orders`);
  return { success: "Order sent to the kitchen and bar queues." };
}

export async function updateOrderItemStatus(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(itemId) ||
    !(itemStatuses as readonly string[]).includes(status)
  ) {
    return;
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("update_order_item_status", {
    p_item_id: itemId,
    p_status: status,
  });

  if (error) {
    console.error("Order item status update failed:", error.message);
    const notice =
      error.code === "23514"
        ? error.message.slice(0, 200)
        : error.code === "42501"
          ? "You are not allowed to make that status change."
          : "The ticket could not be updated. Try again.";
    redirect(
      `/business/${businessId}/orders?notice=${encodeURIComponent(notice)}`,
    );
  }

  revalidatePath(`/business/${businessId}/orders`);
}

export async function deliverTableItems(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const itemIds = formData.getAll("itemIds").map(String);
  if (
    !uuidPattern.test(businessId) ||
    itemIds.length < 1 ||
    itemIds.length > 50 ||
    !itemIds.every((id) => uuidPattern.test(id))
  ) {
    return;
  }

  const supabase = await getAuthenticatedClient();
  let failed = 0;
  for (const itemId of itemIds) {
    const { error } = await supabase.rpc("update_order_item_status", {
      p_item_id: itemId,
      p_status: "delivered",
    });
    if (error) {
      failed += 1;
      console.error("Delivery confirmation failed:", error.message);
    }
  }

  if (failed > 0) {
    redirect(
      `/business/${businessId}/orders?notice=${encodeURIComponent(
        `${failed} item(s) could not be confirmed as delivered.`,
      )}`,
    );
  }
  revalidatePath(`/business/${businessId}/orders`);
}

export async function takeOverTicket(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!uuidPattern.test(businessId) || !uuidPattern.test(itemId)) {
    return;
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("take_over_ticket", { p_item_id: itemId });
  if (error) {
    console.error("Ticket take-over failed:", error.message);
    redirect(
      `/business/${businessId}/orders?notice=${encodeURIComponent(
        error.code === "42501"
          ? "Only a manager can take over a ticket."
          : "The ticket could not be taken over.",
      )}`,
    );
  }

  revalidatePath(`/business/${businessId}/orders`);
}

export async function resolveServiceRequest(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  if (!uuidPattern.test(businessId) || !uuidPattern.test(requestId)) {
    return;
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("resolve_service_request", {
    p_request_id: requestId,
  });
  if (error) {
    console.error("Service request resolve failed:", error.message);
  }

  revalidatePath(`/business/${businessId}/orders`);
}

export async function setMenuItemDepartment(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const departmentKey = String(formData.get("departmentKey") ?? "");

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(menuItemId) ||
    !["kitchen", "bar"].includes(departmentKey)
  ) {
    return;
  }

  const supabase = await getAuthenticatedClient();
  const { error } = await supabase.rpc("set_menu_item_department", {
    p_business_id: businessId,
    p_menu_item_id: menuItemId,
    p_department_key: departmentKey,
  });

  if (error) {
    console.error("Menu item routing failed:", error.message);
  }

  revalidatePath(`/business/${businessId}/menu`);
  revalidatePath(`/business/${businessId}/orders`);
}
