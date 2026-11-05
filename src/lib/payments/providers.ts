import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type Provider = "mtn_momo" | "airtel_money";
export type ProviderState = "pending" | "succeeded" | "failed";
export type ProviderStatus = {
  state: ProviderState;
  txnId?: string;
  reason?: string;
  rawStatus: string;
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  mtn_momo: "MTN Mobile Money",
  airtel_money: "Airtel Money",
};

const TIMEOUT_MS = 15000;

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function isProvider(value: string): value is Provider {
  return value === "mtn_momo" || value === "airtel_money";
}

export function isProviderConfigured(provider: Provider) {
  if (env("PAYMENT_CALLBACK_SECRET").length < 32) {
    return false;
  }
  return provider === "mtn_momo"
    ? Boolean(
        env("MTN_MOMO_SUBSCRIPTION_KEY") &&
          env("MTN_MOMO_API_USER") &&
          env("MTN_MOMO_API_KEY"),
      )
    : Boolean(env("AIRTEL_CLIENT_ID") && env("AIRTEL_CLIENT_SECRET"));
}

// Callback URLs carry an HMAC of the request id. Providers' own callbacks are unsigned or
// unverified, so the callback only triggers a status lookup against the provider API.
export function callbackSignature(provider: Provider, requestId: string) {
  return createHmac("sha256", env("PAYMENT_CALLBACK_SECRET"))
    .update(`${provider}:${requestId}`)
    .digest("hex");
}

export function verifyCallbackSignature(
  provider: Provider,
  requestId: string,
  signature: string | null,
) {
  if (!signature || env("PAYMENT_CALLBACK_SECRET").length < 32) return false;
  const expected = Buffer.from(callbackSignature(provider, requestId));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function callbackUrl(provider: Provider, requestId: string) {
  const base = env("APP_BASE_URL").replace(/\/+$/, "");
  if (!base) return null;
  const path = provider === "mtn_momo" ? "mtn" : "airtel";
  return `${base}/api/payments/${path}/callback/${requestId}?sig=${callbackSignature(provider, requestId)}`;
}

export function normalizeMsisdn(raw: string, provider: Provider) {
  const digits = raw.replace(/[\s\-()+]/g, "");
  if (!/^\d{9,15}$/.test(digits)) return null;
  if (provider === "airtel_money") {
    const dial = env("AIRTEL_DIAL_CODE") || "256";
    return digits.startsWith(dial) ? digits.slice(dial.length) : digits.replace(/^0/, "");
  }
  return digits;
}

async function http(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

type RequestInput = {
  requestId: string;
  amount: number;
  currency: string;
  msisdn: string;
};

// ---- MTN MoMo Collection ----

function mtnBase() {
  return (env("MTN_MOMO_BASE_URL") || "https://sandbox.momodeveloper.mtn.com").replace(/\/+$/, "");
}

function mtnTarget() {
  return env("MTN_MOMO_ENVIRONMENT") || "sandbox";
}

async function mtnToken() {
  const basic = Buffer.from(`${env("MTN_MOMO_API_USER")}:${env("MTN_MOMO_API_KEY")}`).toString("base64");
  const response = await http(`${mtnBase()}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": env("MTN_MOMO_SUBSCRIPTION_KEY"),
    },
  });
  if (!response.ok) throw new Error(`MTN token request failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("MTN token response was invalid");
  return body.access_token;
}

async function mtnRequestToPay(input: RequestInput) {
  const token = await mtnToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Reference-Id": input.requestId,
    "X-Target-Environment": mtnTarget(),
    "Ocp-Apim-Subscription-Key": env("MTN_MOMO_SUBSCRIPTION_KEY"),
    "Content-Type": "application/json",
  };
  const callback = callbackUrl("mtn_momo", input.requestId);
  if (callback && callback.startsWith("https://")) headers["X-Callback-Url"] = callback;

  // The MTN sandbox only accepts EUR; set MTN_MOMO_CURRENCY=EUR while testing there.
  const response = await http(`${mtnBase()}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amount: String(input.amount),
      currency: env("MTN_MOMO_CURRENCY") || input.currency,
      externalId: input.requestId,
      payer: { partyIdType: "MSISDN", partyId: input.msisdn },
      payerMessage: "Sangira order payment",
      payeeNote: "Sangira order payment",
    }),
  });
  if (response.status !== 202) throw new Error(`MTN request was rejected (${response.status})`);
}

async function mtnStatus(requestId: string): Promise<ProviderStatus> {
  const token = await mtnToken();
  const response = await http(`${mtnBase()}/collection/v1_0/requesttopay/${requestId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Target-Environment": mtnTarget(),
      "Ocp-Apim-Subscription-Key": env("MTN_MOMO_SUBSCRIPTION_KEY"),
    },
  });
  if (!response.ok) throw new Error(`MTN status lookup failed (${response.status})`);
  const body = (await response.json()) as {
    status?: string;
    financialTransactionId?: string;
    reason?: string | { code?: string; message?: string };
  };
  const rawStatus = String(body.status ?? "UNKNOWN").toUpperCase();
  const reason = typeof body.reason === "string" ? body.reason : body.reason?.code;
  if (rawStatus === "SUCCESSFUL") {
    return { state: "succeeded", txnId: body.financialTransactionId, rawStatus };
  }
  if (rawStatus === "FAILED") return { state: "failed", reason, rawStatus };
  return { state: "pending", rawStatus };
}

// ---- Airtel Money ----

function airtelBase() {
  return (env("AIRTEL_BASE_URL") || "https://openapiuat.airtel.africa").replace(/\/+$/, "");
}

async function airtelToken() {
  const response = await http(`${airtelBase()}/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify({
      client_id: env("AIRTEL_CLIENT_ID"),
      client_secret: env("AIRTEL_CLIENT_SECRET"),
      grant_type: "client_credentials",
    }),
  });
  if (!response.ok) throw new Error(`Airtel token request failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Airtel token response was invalid");
  return body.access_token;
}

function airtelHeaders(token: string, currency: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "*/*",
    "X-Country": env("AIRTEL_COUNTRY") || "UG",
    "X-Currency": currency,
  };
}

async function airtelRequestToPay(input: RequestInput) {
  const token = await airtelToken();
  const country = env("AIRTEL_COUNTRY") || "UG";
  const currency = env("AIRTEL_CURRENCY") || input.currency;
  const response = await http(`${airtelBase()}/merchant/v1/payments/`, {
    method: "POST",
    headers: airtelHeaders(token, currency),
    body: JSON.stringify({
      reference: "Sangira order payment",
      subscriber: { country, currency, msisdn: input.msisdn },
      transaction: { amount: input.amount, country, currency, id: input.requestId },
    }),
  });
  if (!response.ok) throw new Error(`Airtel request was rejected (${response.status})`);
  const body = (await response.json()) as { status?: { success?: boolean } };
  if (body.status?.success === false) throw new Error("Airtel request was not accepted");
}

async function airtelStatus(requestId: string, currency: string): Promise<ProviderStatus> {
  const token = await airtelToken();
  const response = await http(`${airtelBase()}/standard/v1/payments/${requestId}`, {
    headers: airtelHeaders(token, env("AIRTEL_CURRENCY") || currency),
  });
  if (!response.ok) throw new Error(`Airtel status lookup failed (${response.status})`);
  const body = (await response.json()) as {
    data?: { transaction?: { status?: string; airtel_money_id?: string; message?: string } };
  };
  const transaction = body.data?.transaction;
  const rawStatus = String(transaction?.status ?? "UNKNOWN").toUpperCase();
  if (rawStatus === "TS") {
    return { state: "succeeded", txnId: transaction?.airtel_money_id, rawStatus };
  }
  if (rawStatus === "TF" || rawStatus === "TE") {
    return { state: "failed", reason: transaction?.message ?? rawStatus, rawStatus };
  }
  // TIP (in progress) and TA (ambiguous) stay pending until the provider settles them.
  return { state: "pending", rawStatus };
}

// ---- Public API ----

export async function requestToPay(provider: Provider, input: RequestInput) {
  return provider === "mtn_momo" ? mtnRequestToPay(input) : airtelRequestToPay(input);
}

export async function getProviderStatus(
  provider: Provider,
  requestId: string,
  currency: string,
) {
  return provider === "mtn_momo" ? mtnStatus(requestId) : airtelStatus(requestId, currency);
}
