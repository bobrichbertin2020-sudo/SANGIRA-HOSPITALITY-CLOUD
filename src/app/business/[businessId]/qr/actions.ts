"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireUser() {
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

function back(businessId: string, notice: string) {
  redirect(`/business/${businessId}/qr?notice=${encodeURIComponent(notice)}`);
}

export async function togglePublicOrdering(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!uuidPattern.test(businessId)) return;

  const supabase = await requireUser();
  const { error } = await supabase.rpc("set_public_ordering", {
    p_business_id: businessId,
    p_enabled: enabled,
  });
  if (error) {
    console.error("Public ordering toggle failed:", error.message);
    back(businessId, "Could not update online ordering.");
  }
  revalidatePath(`/business/${businessId}/qr`);
}

export async function saveDiningTables(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  if (!uuidPattern.test(businessId)) return;

  const labels = String(formData.get("labels") ?? "")
    .split(/[\r\n,]+/)
    .map((label) => label.trim())
    .filter(Boolean);

  const supabase = await requireUser();
  const { error } = await supabase.rpc("set_dining_tables", {
    p_business_id: businessId,
    p_labels: labels,
  });
  if (error) {
    console.error("Dining tables update failed:", error.message);
    back(
      businessId,
      error.code === "22023" ? error.message : "Could not save the table list.",
    );
  }
  revalidatePath(`/business/${businessId}/qr`);
}

export async function savePublicProfile(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  if (
    !uuidPattern.test(businessId) ||
    description.length > 500 ||
    imageUrl.length > 2048 ||
    (imageUrl !== "" &&
      (!/^https:\/\//i.test(imageUrl) || /\s/.test(imageUrl)))
  ) {
    if (uuidPattern.test(businessId)) {
      back(businessId, "Enter a description up to 500 characters and an HTTPS image URL.");
    }
    return;
  }

  const supabase = await requireUser();
  const { error } = await supabase.rpc("update_public_business_profile", {
    p_business_id: businessId,
    p_description: description || null,
    p_image_url: imageUrl || null,
  });
  if (error) {
    console.error("Public business profile update failed:", error.message);
    back(
      businessId,
      error.code === "22023"
        ? "Enter a description up to 500 characters and a valid HTTPS image URL."
        : "Could not update the public profile. Check your business permissions.",
    );
  }
  revalidatePath(`/business/${businessId}/qr`);
  back(businessId, "Public profile saved.");
}
