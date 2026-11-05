"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  isProvider,
  isProviderConfigured,
  normalizeMsisdn,
  requestToPay,
} from "@/lib/payments/providers";
import { syncPaymentRequest } from "@/lib/payments/sync";

export type PaymentActionState = {
  error?: string;
  success?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methods = ["cash", "mobile_money", "card", "bank_transfer"];

export async function recordPayment(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const method = String(formData.get("method") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const rawAmount = String(formData.get("amount") ?? "").trim();
  const amount = Number(rawAmount);

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(orderId) ||
    !uuidPattern.test(idempotencyKey) ||
    !methods.includes(method) ||
    reference.length > 100 ||
    (method !== "cash" && reference === "") ||
    !/^\d{1,12}(\.\d{1,2})?$/.test(rawAmount) ||
    !(amount > 0)
  ) {
    return { error: "Enter a valid amount; non-cash payments need a reference." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc("record_payment", {
    p_business_id: businessId,
    p_order_id: orderId,
    p_idempotency_key: idempotencyKey,
    p_amount: amount,
    p_method: method,
    p_reference: reference || null,
  });

  if (error) {
    console.error("Payment recording failed:", error.message);
    return {
      error:
        error.code === "23505"
          ? "That payment reference has already been used."
          : error.code === "42501"
            ? "You do not have permission to record payments."
            : "Payment could not be recorded. It may exceed the amount due.",
    };
  }

  revalidatePath(`/business/${businessId}/payments`);
  revalidatePath(`/business/${businessId}/orders`);
  return { success: "Payment recorded." };
}

export async function recordRefund(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const method = String(formData.get("method") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const rawAmount = String(formData.get("amount") ?? "").trim();
  const amount = Number(rawAmount);

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(orderId) ||
    !uuidPattern.test(idempotencyKey) ||
    !methods.includes(method) ||
    reference.length > 100 ||
    reason.length < 3 ||
    reason.length > 300 ||
    !/^\d{1,12}(\.\d{1,2})?$/.test(rawAmount) ||
    !(amount > 0)
  ) {
    return { error: "Enter a valid amount, method and a reason for the refund." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc("record_refund", {
    p_business_id: businessId,
    p_order_id: orderId,
    p_idempotency_key: idempotencyKey,
    p_amount: amount,
    p_method: method,
    p_reason: reason,
    p_reference: reference || null,
  });

  if (error) {
    console.error("Refund recording failed:", error.message);
    return {
      error:
        error.code === "42501"
          ? "You do not have permission to record refunds."
          : "Refund could not be recorded. It may exceed the amount paid for cancelled items.",
    };
  }

  revalidatePath(`/business/${businessId}/payments`);
  revalidatePath(`/business/${businessId}/orders`);
  return { success: "Refund recorded." };
}

export async function setPaymentTiming(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const timing = String(formData.get("timing") ?? "");
  if (!uuidPattern.test(businessId) || !["before", "after"].includes(timing)) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc("set_payment_timing", {
    p_business_id: businessId,
    p_timing: timing,
  });
  if (error) {
    console.error("Payment timing update failed:", error.message);
  }

  revalidatePath(`/business/${businessId}/payments`);
}

export async function closeCashierShift(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const rawCounted = String(formData.get("counted") ?? "").trim();
  const counted = Number(rawCounted);

  if (
    !uuidPattern.test(businessId) ||
    notes.length > 300 ||
    !/^\d{1,12}(\.\d{1,2})?$/.test(rawCounted) ||
    !(counted >= 0)
  ) {
    return { error: "Enter the cash counted in the drawer." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc("close_cashier_shift", {
    p_business_id: businessId,
    p_counted: counted,
    p_notes: notes || null,
  });
  if (error) {
    console.error("Cashier close-out failed:", error.message);
    return {
      error:
        error.code === "22023"
          ? error.message
          : "The shift could not be closed. Try again.",
    };
  }

  revalidatePath(`/business/${businessId}/payments`);
  return { success: "Shift closed and recorded." };
}

export async function requestMobileMoney(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const businessId = String(formData.get("businessId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const rawAmount = String(formData.get("amount") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "");
  const amount = Number(rawAmount);

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(orderId) ||
    !uuidPattern.test(idempotencyKey) ||
    !isProvider(provider) ||
    !/^\d{1,12}(\.\d{1,2})?$/.test(rawAmount) ||
    !(amount > 0)
  ) {
    return { error: "Enter a valid amount, provider and phone number." };
  }
  const msisdn = normalizeMsisdn(rawPhone, provider);
  if (!msisdn) {
    return { error: "Enter the customer's mobile number including country code." };
  }
  if (!isAdminConfigured() || !isProviderConfigured(provider)) {
    return { error: "This payment provider is not configured on the server yet." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const { data: requestId, error } = await supabase.rpc("create_payment_request", {
    p_business_id: businessId,
    p_order_id: orderId,
    p_idempotency_key: idempotencyKey,
    p_provider: provider,
    p_amount: amount,
    p_msisdn_last4: msisdn.slice(-4),
  });

  if (error || !requestId) {
    console.error("Payment request creation failed:", error?.message);
    return {
      error:
        error?.code === "23505"
          ? "A mobile money request is already pending for this order."
          : error?.code === "42501"
            ? "You do not have permission to request payments."
            : "Request could not be created. It may exceed the amount due.",
    };
  }

  const { data: created } = await supabase
    .from("payment_requests")
    .select("id, status, currency")
    .eq("id", requestId)
    .maybeSingle();

  // A retried submission returns the same request; do not prompt the customer twice.
  if (created && created.status === "pending") {
    const { data: events } = await createAdminClient()
      .from("payment_provider_events")
      .select("id")
      .eq("payment_request_id", requestId)
      .limit(1);

    if (!events?.length) {
      try {
        await requestToPay(provider, {
          requestId,
          amount,
          currency: created.currency,
          msisdn,
        });
        await createAdminClient().from("payment_provider_events").insert({
          payment_request_id: requestId,
          source: "initiate",
          provider_status: "REQUESTED",
        });
      } catch (providerError) {
        console.error("Provider request failed:", (providerError as Error).message);
        await createAdminClient().rpc("fail_payment_request", {
          p_request_id: requestId,
          p_reason: "Provider rejected or could not be reached",
        });
        revalidatePath(`/business/${businessId}/payments`);
        return { error: "The provider did not accept the request. Try again in a moment." };
      }
    }
  }

  revalidatePath(`/business/${businessId}/payments`);
  return { success: "Prompt sent. Ask the customer to approve it on their phone." };
}

export async function refreshPaymentRequest(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  if (!uuidPattern.test(businessId) || !uuidPattern.test(requestId) || !isAdminConfigured()) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  // The RLS-scoped read proves the caller may manage this business's payments.
  const { data: request } = await supabase
    .from("payment_requests")
    .select("id")
    .eq("id", requestId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (request) {
    await syncPaymentRequest(request.id, "poll");
  }

  revalidatePath(`/business/${businessId}/payments`);
  revalidatePath(`/business/${businessId}/orders`);
}
