"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function reviewApplication(formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reviewNotes = String(formData.get("reviewNotes") ?? "").trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      applicationId,
    ) ||
    !["approved", "rejected"].includes(decision) ||
    reviewNotes.length > 2000
  ) {
    redirect("/admin/applications?error=invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc("review_business_application", {
    p_application_id: applicationId,
    p_decision: decision,
    p_review_notes: reviewNotes || null,
  });

  if (error) {
    console.error("Business application review failed:", error.message);
    redirect("/admin/applications?error=review");
  }

  redirect("/admin/applications?notice=reviewed");
}
