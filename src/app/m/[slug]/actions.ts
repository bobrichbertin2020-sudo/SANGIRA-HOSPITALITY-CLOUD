"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import {
  TABLE_COOKIE,
  createSessionToken,
  hashClient,
  newNonce,
  sessionCookieOptions,
  sha256Hex,
  verifySessionToken,
} from "@/lib/qr/session";

export type CustomerActionState = {
  error?: string;
  success?: string;
};

const slugPattern = /^[a-z0-9][a-z0-9-]{0,80}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const customerFacingCodes = new Set(["22023", "P0401", "P0403", "P0429"]);

function customerMessage(
  error: { code?: string; message: string },
  fallback: string,
  t: (text: string) => string,
) {
  return t(error.code && customerFacingCodes.has(error.code) ? error.message : fallback);
}

async function clientKey() {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  return hashClient(forwarded || requestHeaders.get("x-real-ip"));
}

export async function startTableSession(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const slug = String(formData.get("slug") ?? "");
  const tableLabel = String(formData.get("tableLabel") ?? "").trim();
  const { t } = await getT();

  // Honeypot: real customers never fill this hidden field.
  if (formData.get("website")) {
    return { error: t("Could not start your session. Please try again.") };
  }
  if (!slugPattern.test(slug) || tableLabel.length < 1 || tableLabel.length > 20) {
    return { error: t("Enter your table number.") };
  }

  const nonce = newNonce();
  const { data, error } = await createAdminClient().rpc("start_table_session", {
    p_slug: slug,
    p_table_label: tableLabel,
    p_nonce_hash: sha256Hex(nonce),
    p_client_hash: await clientKey(),
  });

  if (error || !data) {
    console.error("Table session failed:", error?.message);
    return {
      error: error
        ? customerMessage(error, "Could not start your session. Please try again.", t)
        : t("Could not start your session. Please try again."),
    };
  }

  const sessionId = String((data as { session_id: string }).session_id);
  (await cookies()).set(
    TABLE_COOKIE,
    createSessionToken(sessionId, nonce, slug),
    sessionCookieOptions,
  );
  redirect(`/m/${slug}`);
}

export async function placeCustomerOrder(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const slug = String(formData.get("slug") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const { t } = await getT();

  if (formData.get("website")) {
    return { error: t("Could not send your order. Please try again.") };
  }
  if (!slugPattern.test(slug) || notes.length > 300) {
    return { error: t("Check your order and try again.") };
  }

  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(TABLE_COOKIE)?.value, slug);
  if (!session) {
    return { error: t("Your ordering session has expired. Please start again.") };
  }

  const items: { menu_item_id: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_")) continue;
    const menuItemId = key.slice(4);
    const quantity = Number(String(value));
    if (!uuidPattern.test(menuItemId) || !Number.isInteger(quantity) || quantity < 0) {
      return { error: t("Quantities must be whole numbers.") };
    }
    if (quantity > 0) {
      items.push({ menu_item_id: menuItemId, quantity });
    }
  }
  if (items.length < 1 || items.length > 30) {
    return { error: t("Choose at least one item.") };
  }

  const { data, error } = await createAdminClient().rpc("place_customer_order", {
    p_session_id: session.sessionId,
    p_nonce_hash: session.nonceHash,
    p_notes: notes || null,
    p_items: items,
  });

  if (error || !data) {
    console.error("Customer order failed:", error?.message);
    if (error?.code === "P0401") {
      cookieStore.delete({ name: TABLE_COOKIE, path: "/m" });
    }
    return {
      error: error
        ? customerMessage(error, "Your order could not be sent. Please try again.", t)
        : t("Your order could not be sent. Please try again."),
    };
  }

  revalidatePath(`/m/${slug}`);
  return {
    success: t("Order {code} sent to the kitchen and bar.", {
      code: (data as { order_code: string }).order_code,
    }),
  };
}

export async function cancelCustomerOrder(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const orderCode = String(formData.get("orderCode") ?? "");
  if (!slugPattern.test(slug) || !/^[A-Za-z0-9-]{1,30}$/.test(orderCode)) {
    return;
  }
  const session = verifySessionToken((await cookies()).get(TABLE_COOKIE)?.value, slug);
  if (!session) {
    return;
  }

  const { error } = await createAdminClient().rpc("cancel_customer_order", {
    p_session_id: session.sessionId,
    p_nonce_hash: session.nonceHash,
    p_order_code: orderCode,
  });
  if (error) {
    console.error("Guest order cancel failed:", error.message);
  }
  revalidatePath(`/m/${slug}`);
}

export async function sendServiceRequest(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const type = String(formData.get("type") ?? "");
  if (!slugPattern.test(slug) || !["call_waiter", "request_bill"].includes(type)) {
    return;
  }
  const session = verifySessionToken((await cookies()).get(TABLE_COOKIE)?.value, slug);
  if (!session) {
    return;
  }

  const { error } = await createAdminClient().rpc("create_service_request", {
    p_session_id: session.sessionId,
    p_nonce_hash: session.nonceHash,
    p_type: type,
  });
  if (error) {
    console.error("Service request failed:", error.message);
  }
  revalidatePath(`/m/${slug}`);
}

export async function endTableSession(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  (await cookies()).delete({ name: TABLE_COOKIE, path: "/m" });
  redirect(slugPattern.test(slug) ? `/m/${slug}` : "/");
}
