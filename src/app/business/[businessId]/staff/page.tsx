import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import {
  revokeStaffInvitation,
} from "@/app/business/[businessId]/staff/actions";
import { InviteForm } from "@/app/business/[businessId]/staff/invite-form";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type StaffPageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function StaffPage({
  params,
  searchParams,
}: StaffPageProps) {
  const [{ businessId }, { error: pageError, notice }] = await Promise.all([
    params,
    searchParams,
  ]);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      businessId,
    )
  ) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const [
    { data: canViewStaff, error: viewPermissionError },
    { data: canManageStaff, error: managePermissionError },
  ] = await Promise.all([
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "staff.view",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "staff.manage",
    }),
  ]);

  if (viewPermissionError || managePermissionError) {
    console.error(
      "Staff permission check failed:",
      [viewPermissionError, managePermissionError]
        .filter(Boolean)
        .map((error) => error?.message)
        .join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Staff access could not be verified. Confirm the database migrations are applied.
        </p>
      </main>
    );
  }

  if (!canViewStaff && !canManageStaff) {
    redirect("/dashboard");
  }

  const [
    { data: business, error: businessError },
    { data: departments, error: departmentsError },
    { data: memberships, error: membershipsError },
    { data: roleOptions, error: rolesError },
    { data: invitations, error: invitationsError },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("departments")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("is_enabled", true)
      .order("name"),
    supabase
      .from("business_memberships")
      .select("id, user_id, status, created_at")
      .eq("business_id", businessId)
      .order("created_at"),
    supabase
      .from("roles")
      .select("role_key, label")
      .neq("role_key", "business_owner")
      .order("label"),
    canManageStaff
      ? supabase
          .from("staff_invitations")
          .select("id, email, role_keys, department_ids, status, expires_at, created_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (businessError || departmentsError || membershipsError || rolesError || invitationsError) {
    const errors = [
      businessError,
      departmentsError,
      membershipsError,
      rolesError,
      invitationsError,
    ].filter(Boolean);
    console.error(
      "Unable to load staff workspace data:",
      errors.map((item) => item?.message).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Staff workspace data could not be loaded. Refresh and try again.
        </p>
      </main>
    );
  }

  if (!business) {
    notFound();
  }

  const membershipIds = (memberships ?? []).map((membership) => membership.id);
  const userIds = [...new Set((memberships ?? []).map((membership) => membership.user_id))];
  const [
    { data: profiles, error: profilesError },
    { data: assignedRoles, error: assignedRolesError },
    { data: departmentAssignments, error: departmentAssignmentsError },
  ] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    membershipIds.length
      ? supabase
          .from("membership_roles")
          .select("membership_id, role_key")
          .in("membership_id", membershipIds)
      : Promise.resolve({ data: [], error: null }),
    membershipIds.length
      ? supabase
          .from("membership_departments")
          .select("membership_id, department_id")
          .in("membership_id", membershipIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesError || assignedRolesError || departmentAssignmentsError) {
    const errors = [
      profilesError,
      assignedRolesError,
      departmentAssignmentsError,
    ].filter(Boolean);
    console.error(
      "Unable to load staff assignments:",
      errors.map((item) => item?.message).join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Employee details could not be loaded. Refresh and try again.
        </p>
      </main>
    );
  }

  const profileByUser = new Map(
    (profiles ?? []).map((profile) => [profile.user_id, profile.full_name]),
  );
  const roleLabels = new Map(
    (roleOptions ?? []).map((role) => [role.role_key, role.label]),
  );
  const departmentNames = new Map(
    (departments ?? []).map((department) => [department.id, department.name]),
  );

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-3">
            <AccountLink />
            <form action={signOut}>
              <button className="rounded-lg border border-[#d6ded8] px-4 py-2 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          {canManageStaff ? "Staff management" : "Team"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          {canManageStaff
            ? "Invite employees, assign department access, and manage role-based permissions."
            : "View your team members, their responsibilities, and department assignments."}
        </p>
        {notice === "joined-business" && (
          <p className="mt-6 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
            You joined the business workspace.
          </p>
        )}
        {notice === "invitation-invalid" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            The invitation is invalid, expired, already used, or belongs to a different email address.
          </p>
        )}
        {notice === "invitation-revoked" && (
          <p className="mt-6 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]">
            The invitation is no longer active.
          </p>
        )}
        {pageError === "invitation-revoke" && (
          <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            The invitation could not be revoked. It may have already been accepted or revoked.
          </p>
        )}

        <div className={canManageStaff ? "mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]" : "mt-8"}>
          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Employees</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              Active members and their assigned access.
            </p>
            {memberships?.length ? (
              <ul className="mt-5 divide-y divide-[#edf0ed]">
                {memberships.map((membership) => {
                  const roles = (assignedRoles ?? [])
                    .filter((role) => role.membership_id === membership.id)
                    .map((role) =>
                      roleLabels.get(role.role_key) ?? role.role_key,
                    );
                  const departmentList = (departmentAssignments ?? [])
                    .filter(
                      (assignment) => assignment.membership_id === membership.id,
                    )
                    .map(
                      (assignment) =>
                        departmentNames.get(assignment.department_id),
                    )
                    .filter(Boolean);

                  return (
                    <li className="py-4" key={membership.id}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">
                            {profileByUser.get(membership.user_id) || "Team member"}
                          </p>
                          <p className="mt-1 text-xs text-[#64736a]">
                            {roles.join(", ") || "No roles assigned"}
                          </p>
                          <p className="mt-1 text-xs text-[#85938a]">
                            {departmentList.join(", ") || "No departments assigned"}
                          </p>
                        </div>
                        <span className="w-fit rounded-full bg-[#edf6ef] px-3 py-1 text-xs font-semibold capitalize text-[#34714d]">
                          {membership.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-5 rounded-xl border border-dashed border-[#d6ded8] px-5 py-8 text-center text-sm text-[#64736a]">
                No employees are registered yet.
              </p>
            )}
          </section>

          {canManageStaff && (
            <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
              <h2 className="text-lg font-semibold">Invite an employee</h2>
              <p className="mt-1 text-sm leading-6 text-[#64736a]">
                Create a single-use link for an existing or new Sangira account.
              </p>
              {departments?.length && roleOptions?.length ? (
                <div className="mt-5">
                  <InviteForm
                    businessId={businessId}
                    departments={departments}
                    roles={roleOptions}
                  />
                </div>
              ) : (
                <p className="mt-5 rounded-lg bg-[#fff9ed] px-4 py-3 text-sm leading-6 text-[#765321]">
                  Enable at least one department and ensure the role catalog is available before inviting staff.
                </p>
              )}
            </section>
          )}
        </div>

        {canManageStaff && (
          <section className="mt-8 rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Invitations</h2>
            {invitations?.length ? (
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {invitations.map((invitation) => (
                  <li
                    className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={invitation.id}
                  >
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="mt-1 text-xs text-[#64736a]">
                        {invitation.role_keys
                          .map((role: string) => roleLabels.get(role) ?? role)
                          .join(", ")}
                      </p>
                      <p className="mt-1 text-xs text-[#85938a]">
                        Expires {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="w-fit rounded-full bg-[#f2f4f2] px-3 py-1 text-xs font-semibold capitalize text-[#53635a]">
                      {invitation.status}
                    </span>
                    {invitation.status === "pending" && (
                      <form action={revokeStaffInvitation}>
                        <input name="businessId" type="hidden" value={businessId} />
                        <input name="invitationId" type="hidden" value={invitation.id} />
                        <button className="rounded-lg border border-[#e8c9c3] px-3 py-2 text-sm font-semibold text-[#9c392d] hover:bg-[#fff1ee]">
                          Revoke
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[#64736a]">No employee invitations yet.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
