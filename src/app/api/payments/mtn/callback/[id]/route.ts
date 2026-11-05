import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { verifyCallbackSignature } from "@/lib/payments/providers";
import { syncPaymentRequest } from "@/lib/payments/sync";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The body is ignored on purpose: the provider status API is the source of truth.
async function handle(request: Request, id: string) {
  const signature = new URL(request.url).searchParams.get("sig");
  if (!uuidPattern.test(id) || !verifyCallbackSignature("mtn_momo", id, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const result = await syncPaymentRequest(id, "callback", "mtn_momo");
  // A non-2xx on a transient error asks the provider to retry.
  return NextResponse.json({ ok: result.state !== "error" }, {
    status: result.state === "error" ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(request, (await context.params).id);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(request, (await context.params).id);
}
