import "server-only";
import { roleLabels, type MyProfile } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

export type ProfileSummary = {
  name: string;
  email: string;
  initials: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasPhone: boolean;
  isPlatformAdmin: boolean;
  deletionPending: boolean;
  workspaces: { business: string; roles: string[]; departments: string[] }[];
};

// Returns null when signed out or when the personal settings migration is unavailable.
export async function loadProfileSummary(): Promise<ProfileSummary | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }, { data: isAdmin }, { data: deletion }] =
    await Promise.all([
      supabase.rpc("get_my_profile").maybeSingle<MyProfile>(),
      supabase
        .from("business_memberships")
        .select("id, status, businesses(name), membership_roles(role_key)")
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase.rpc("is_platform_admin"),
      supabase
        .from("account_deletion_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .maybeSingle(),
    ]);
  if (!profile) return null;

  const ids = (memberships ?? []).map((item) => item.id);
  const { data: assignments } = ids.length
    ? await supabase
        .from("membership_departments")
        .select("membership_id, department_id")
        .in("membership_id", ids)
    : { data: [] };
  const departmentIds = [...new Set((assignments ?? []).map((item) => item.department_id))];
  const { data: departments } = departmentIds.length
    ? await supabase.from("departments").select("id, name").in("id", departmentIds)
    : { data: [] };
  const departmentNames = new Map((departments ?? []).map((item) => [item.id, item.name]));

  let avatarUrl: string | null = null;
  if (profile.avatar_path) {
    const { data } = await supabase.storage
      .from("sangira-avatars")
      .createSignedUrl(profile.avatar_path, 3600);
    avatarUrl = data?.signedUrl ?? null;
  }

  const name =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    profile.full_name ||
    user.email ||
    "Account";

  return {
    name,
    email: user.email ?? "",
    initials:
      `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase() ||
      name[0].toUpperCase(),
    avatarUrl,
    emailVerified: Boolean(user.email_confirmed_at),
    hasPhone: Boolean(profile.phone),
    isPlatformAdmin: Boolean(isAdmin),
    deletionPending: Boolean(deletion),
    workspaces: (memberships ?? []).map((membership) => {
      const business = Array.isArray(membership.businesses)
        ? membership.businesses[0]
        : membership.businesses;
      const roles = Array.isArray(membership.membership_roles)
        ? membership.membership_roles
        : membership.membership_roles
          ? [membership.membership_roles]
          : [];
      return {
        business: business?.name ?? "Business",
        roles: roles.map((role) => roleLabels[role.role_key] ?? role.role_key),
        departments: (assignments ?? [])
          .filter((item) => item.membership_id === membership.id)
          .map((item) => departmentNames.get(item.department_id))
          .filter((value): value is string => Boolean(value)),
      };
    }),
  };
}
