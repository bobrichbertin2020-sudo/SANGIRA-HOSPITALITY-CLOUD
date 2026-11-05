"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type StaffInviteState = {
  error?: string;
  invitationPath?: string;
};

export async function createStaffInvitation(
  _previousState: StaffInviteState,
  formData: FormData,
): Promise<StaffInviteState> {
  const businessId = String(formData.get("businessId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleKeys = [...new Set(formData.getAll("roleKeys").map(String))];
  const departmentIds = [
    ...new Set(formData.getAll("departmentIds").map(String)),
  ];

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      businessId,
    ) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    roleKeys.length < 1 ||
    roleKeys.length > 9 ||
    roleKeys.includes("business_owner") ||
    roleKeys.some((role) => !/^[a-z_]{2,40}$/.test(role)) ||
    departmentIds.length < 1 ||
    departmentIds.length > 6 ||
    departmentIds.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  ) {
    return { error: "Enter a valid email and choose at least one role and department." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabase.rpc("create_staff_invitation", {
    p_business_id: businessId,
    p_email: email,
    p_role_keys: roleKeys,
    p_department_ids: departmentIds,
    p_token_hash: tokenHash,
  });

  if (error) {
    console.error("Staff invitation creation failed:", error.message);
    if (error.code === "23505") {
      return {
        error: "This person already belongs to the business or has a pending invitation.",
      };
    }

    return {
      error: "The invitation could not be created. Check your permissions and try again.",
    };
  }

  return {
    invitationPath: `/business/invitations/accept?token=${encodeURIComponent(token)}`,
  };
}

export async function acceptStaffInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "");

  if (!/^[0-9a-f]{64}$/.test(token)) {
    redirect("/dashboard?notice=invitation-invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabase.rpc("accept_staff_invitation", {
    p_token_hash: tokenHash,
  });

  if (error) {
    console.error("Staff invitation acceptance failed:", error.message);
    redirect("/dashboard?notice=invitation-invalid");
  }

  redirect("/dashboard?notice=joined-business");
}

export async function revokeStaffInvitation(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  const businessPath = `/business/${encodeURIComponent(businessId)}/staff`;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      businessId,
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      invitationId,
    )
  ) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.rpc("revoke_staff_invitation", {
    p_invitation_id: invitationId,
  });

  if (error) {
    console.error("Staff invitation revocation failed:", error.message);
    redirect(`${businessPath}?error=invitation-revoke`);
  }

  redirect(`${businessPath}?notice=invitation-revoked`);
}
