import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Authorization is enforced by RLS on the metadata row and on the storage
// object. The browser only ever receives a short-lived signed URL.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const { data: document } = await supabase
    .from("business_documents")
    .select("storage_path, original_name")
    .eq("id", id)
    .maybeSingle();
  if (!document) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("sangira-documents")
    .createSignedUrl(document.storage_path, 60, { download: document.original_name });
  if (error || !signed) {
    console.error("Signed URL failed:", error?.message);
    return new NextResponse("Not found", { status: 404 });
  }

  await supabase.rpc("log_document_access", { p_document_id: id });

  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
