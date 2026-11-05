"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const businessTypes = new Set([
  "hotel",
  "restaurant",
  "bar",
  "lounge",
  "hotel_restaurant",
]);

export async function submitBusinessApplication(formData: FormData) {
  const businessName = String(formData.get("businessName") ?? "").trim();
  const businessType = String(formData.get("businessType") ?? "");
  const country = String(formData.get("country") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "")
    .trim()
    .toLowerCase();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const registrationNumber = String(
    formData.get("registrationNumber") ?? "",
  ).trim();

  if (
    businessName.length < 2 ||
    businessName.length > 160 ||
    !businessTypes.has(businessType) ||
    country.length < 2 ||
    country.length > 100 ||
    location.length < 2 ||
    location.length > 240 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ||
    contactPhone.length < 5 ||
    contactPhone.length > 40 ||
    registrationNumber.length > 100
  ) {
    redirect("/business/apply?error=invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.from("business_applications").insert({
    applicant_user_id: user.id,
    business_name: businessName,
    business_type: businessType,
    country,
    location,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    registration_number: registrationNumber || null,
  });

  if (error) {
    if (error.code === "23505") {
      redirect("/dashboard?notice=application-pending");
    }

    console.error("Business application submission failed:", error.message);
    redirect("/business/apply?error=submit");
  }

  redirect("/dashboard?notice=application-submitted");
}
