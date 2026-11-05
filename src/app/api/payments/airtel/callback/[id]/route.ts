import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { verifyCallbackSignature } from "@/lib/payments/providers";
import { syncPaymentRequest } from "@/lib/payments/sync";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Airtel callbacks are not trusted for payment state; we confirm through the status API.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const signature = new URL(request.url).searchParams.get("sig");
  if (!uuidPattern.test(id) || !verifyCallbackSignature("airtel_money", id, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const result = await syncPaymentRequest(id, "callback", "airtel_money");
  return NextResponse.json({ ok: result.state !== "error" }, {
    status: result.state === "error" ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
