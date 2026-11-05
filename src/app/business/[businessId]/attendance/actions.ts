"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function recordAttendance(formData: FormData, action: "clock_in" | "clock_out") {
  const businessId = String(formData.get("businessId") ?? "");
  if (!uuidPattern.test(businessId)) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc(action, { p_business_id: businessId });
  if (error) {
    console.error("Attendance update failed:", error.message);
    const notice =
      error.code === "23505" || error.code === "P0002"
        ? error.message
        : "Attendance could not be updated. Try again.";
    redirect(
      `/business/${businessId}/attendance?notice=${encodeURIComponent(notice)}`,
    );
  }

  revalidatePath(`/business/${businessId}/attendance`);
}

export async function clockIn(formData: FormData) {
  await recordAttendance(formData, "clock_in");
}

export async function clockOut(formData: FormData) {
  await recordAttendance(formData, "clock_out");
}
