import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderStatus, type Provider } from "@/lib/payments/providers";

export type SyncResult = {
  state: "pending" | "succeeded" | "failed" | "missing" | "error";
};

// Confirms a request with the provider status API, then settles or fails it.
// Safe to call repeatedly (callbacks, manual refresh): settlement is idempotent in the database.
export async function syncPaymentRequest(
  requestId: string,
  source: "callback" | "poll",
  expectedProvider?: Provider,
): Promise<SyncResult> {
  const admin = createAdminClient();
  const { data: request, error } = await admin
    .from("payment_requests")
    .select("id, provider, currency, status")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    console.error("Payment request lookup failed:", error.message);
    return { state: "error" };
  }
  if (!request || (expectedProvider && request.provider !== expectedProvider)) {
    return { state: "missing" };
  }
  if (request.status !== "pending") {
    return { state: request.status as SyncResult["state"] };
  }

  let status;
  try {
    status = await getProviderStatus(request.provider as Provider, request.id, request.currency);
  } catch (providerError) {
    console.error("Provider status lookup failed:", (providerError as Error).message);
    return { state: "error" };
  }

  await admin.from("payment_provider_events").insert({
    payment_request_id: request.id,
    source,
    provider_status: status.rawStatus,
  });

  if (status.state === "succeeded") {
    const { error: settleError } = await admin.rpc("settle_payment_request", {
      p_request_id: request.id,
      p_provider_txn_id: status.txnId ?? "",
    });
    if (settleError) {
      console.error("Payment settlement failed:", settleError.message);
      return { state: "error" };
    }
  } else if (status.state === "failed") {
    await admin.rpc("fail_payment_request", {
      p_request_id: request.id,
      p_reason: status.reason ?? status.rawStatus,
    });
  }
  return { state: status.state };
}
