import Link from "next/link";
import { Logo } from "@/components/logo";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { ProfileCard } from "@/components/profile-card";
import { loadProfileSummary } from "@/lib/settings/summary";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type DashboardPageProps = {
  searchParams: Promise<{ notice?: string }>;
};

const notices: Record<string, string> = {
  "application-submitted": "Your business application has been submitted for review.",
  "application-pending": "You already have an application awaiting review.",
  "password-updated": "Your password has been updated.",
  "joined-business": "You joined the business workspace.",
  "invitation-invalid":
    "The invitation is invalid, expired, already used, or belongs to a different email address.",
  "stock-received": "Stock receipt recorded.",
  "stock-request-submitted": "Stock request submitted.",
  "stock-request-reviewed": "Stock request review saved.",
  "stock-issued": "Stock issued; department and central balances are updated.",
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  await connection();
  const { notice } = await searchParams;
  const { t } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/sign-in");
  }

  const { data: applications, error: applicationsError } = await supabase
    .from("business_applications")
    .select("id, business_name, business_type, status, created_at")
    .order("created_at", { ascending: false });

  if (applicationsError) {
    console.error("Unable to load business applications:", applicationsError.message);
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("business_memberships")
    .select(
      "business_id, status, businesses(name, business_code, status), membership_roles(role_key)",
    )
    .order("created_at", { ascending: false });

  if (membershipsError) {
    console.error("Unable to load business memberships:", membershipsError.message);
  }

  const memberRoleKeys = [
    ...new Set(
      (memberships ?? []).flatMap((membership) => {
        const roles = Array.isArray(membership.membership_roles)
          ? membership.membership_roles
          : membership.membership_roles
            ? [membership.membership_roles]
            : [];
        return roles.map((role) => role.role_key);
      }),
    ),
  ];
  const { data: rolePermissions, error: permissionsError } = memberRoleKeys.length
    ? await supabase
        .from("role_permissions")
        .select("role_key, permission_key")
        .in("role_key", memberRoleKeys)
    : { data: [], error: null };

  if (permissionsError) {
    console.error("Unable to load workspace permissions:", permissionsError.message);
  }

  const { data: isPlatformAdmin, error: roleError } = await supabase.rpc(
    "is_platform_admin",
  );

  if (roleError) {
    console.error("Unable to verify platform administrator access:", roleError.message);
  }

  const profileSummary = await loadProfileSummary();
  const hasActiveMembership = memberships?.some(
    (membership) => membership.status === "active",
  );
  const showApplications = !hasActiveMembership || (applications?.length ?? 0) > 0;

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-3">
            <AccountLink />
            <form action={signOut}>
              <button className="rounded-lg border border-[#d6ded8] px-4 py-2 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                {t("Sign out")}
              </button>
            </form>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          {t("Your Sangira")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {t("Welcome")}
          {user.user_metadata.full_name ? `, ${user.user_metadata.full_name}` : ""}
        </h1>
        <p className="mt-2 text-sm text-[#64736a]">
          {t("Your workspaces and responsibilities.")}
        </p>
        {notice && notices[notice] && (
          <p
            role={notice === "invitation-invalid" ? "alert" : undefined}
            className={
              notice === "invitation-invalid"
                ? "mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]"
                : "mt-6 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-4 py-3 text-sm text-[#285c3e]"
            }
          >
            {t(notices[notice])}
          </p>
        )}
        {profileSummary && <ProfileCard profile={profileSummary} />}
        {isPlatformAdmin && (
          <Link
            className="mt-6 inline-block rounded-lg border border-[#d6ded8] bg-white px-4 py-2.5 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]"
            href="/admin/applications"
          >
            {t("Review business applications")}
          </Link>
        )}

        <div
          className={`mt-9 grid gap-8 ${showApplications ? "lg:grid-cols-[1.2fr_0.8fr]" : ""}`}
        >
          {showApplications && (
            <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{t("Business applications")}</h2>
                <p className="mt-1 text-sm text-[#64736a]">
                  {t("Track registrations submitted by your account.")}
                </p>
              </div>
              <Link
                className="shrink-0 rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#205443]"
                href="/business/apply"
              >
                {t("New application")}
              </Link>
            </div>
            {applicationsError ? (
              <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
                {t("Applications could not be loaded. Refresh and try again.")}
              </p>
            ) : applications?.length ? (
              <ul className="mt-6 divide-y divide-[#edf0ed]">
                {applications.map((application) => (
                  <li
                    className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={application.id}
                  >
                    <div>
                      <p className="font-medium">{application.business_name}</p>
                      <p className="mt-1 text-xs capitalize text-[#85938a]">
                        {t(application.business_type.replaceAll("_", " "))}
                      </p>
                    </div>
                    <span className="w-fit rounded-full bg-[#f2f4f2] px-3 py-1 text-xs font-semibold capitalize text-[#53635a]">
                      {t(application.status.replaceAll("_", " "))}
                    </span>
                    {["submitted", "under_review"].includes(application.status) && (
                      <Link
                        className="text-sm font-semibold text-[#153d32] hover:underline"
                        href="/business/apply/documents"
                      >
                        {t("Documents")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-6 rounded-xl border border-dashed border-[#d6ded8] px-5 py-8 text-center">
                <p className="text-sm font-medium">{t("No applications yet")}</p>
                <p className="mt-1 text-sm text-[#64736a]">
                  {t("Register your business to begin platform review.")}
                </p>
              </div>
            )}
            </section>
          )}

          <section className="rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold">{t("Business workspaces")}</h2>
            <p className="mt-1 text-sm text-[#64736a]">
              {t("Approved workspaces you are authorized to access.")}
            </p>
            {membershipsError ? (
              <p role="alert" className="mt-6 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
                {t("Workspaces could not be loaded. Refresh and try again.")}
              </p>
            ) : memberships?.length ? (
              <ul className="mt-6 space-y-3">
                {memberships.map((membership) => {
                  const business = Array.isArray(membership.businesses)
                    ? membership.businesses[0]
                    : membership.businesses;
                  const roles = Array.isArray(membership.membership_roles)
                    ? membership.membership_roles
                    : membership.membership_roles
                      ? [membership.membership_roles]
                      : [];
                  const roleKeys = roles.map((role) => role.role_key);
                  const permissionKeys = new Set(
                    (rolePermissions ?? [])
                      .filter((permission) => roleKeys.includes(permission.role_key))
                      .map((permission) => permission.permission_key),
                  );
                  const hasPermission = (...keys: string[]) =>
                    keys.some((key) => permissionKeys.has(key));
                  const activeWorkspace =
                    membership.status === "active" && business?.status === "active";
                  return (
                    <li className="rounded-xl border border-[#edf0ed] p-4" key={membership.business_id}>
                      <p className="font-semibold">{business?.name ?? t("Business workspace")}</p>
                      <p className="mt-1 text-xs text-[#64736a]">
                        {business?.business_code ?? t("ID pending")} · {t(membership.status)}
                      </p>
                      {permissionsError ? (
                        <p role="alert" className="mt-3 text-sm text-[#9c392d]">
                          {t("Workspace links could not be verified. Refresh and try again.")}
                        </p>
                      ) : activeWorkspace ? (
                        <nav
                          aria-label={`${business?.name ?? "Business"} workspace`}
                          className="mt-3 flex flex-wrap gap-x-4 gap-y-2"
                        >
                          {hasPermission("reports.view", "hotel.view", "restaurant.view") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/overview`}
                            >
                              {t("Today")}
                            </Link>
                          )}
                          {hasPermission(
                            "hotel.view",
                            "hotel.frontdesk",
                            "hotel.housekeeping",
                            "hotel.manage",
                          ) && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/hotel`}
                            >
                              {t("Hotel")}
                            </Link>
                          )}
                          {hasPermission("staff.view", "staff.manage") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/staff`}
                            >
                              {hasPermission("staff.manage") ? t("Manage staff") : t("Team")}
                            </Link>
                          )}
                          {hasPermission("shifts.manage") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/attendance`}
                            >
                              {t("Attendance")}
                            </Link>
                          )}
                          {hasPermission(
                            "inventory.view",
                            "inventory.manage",
                            "inventory.request",
                            "inventory.requests.review",
                          ) && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/inventory`}
                            >
                              {t("Inventory")}
                            </Link>
                          )}
                          {hasPermission(
                            "orders.view",
                            "orders.manage",
                            "kitchen.prepare",
                            "bar.prepare",
                            "service.confirm",
                          ) && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/orders`}
                            >
                              {t("Orders")}
                            </Link>
                          )}
                          {hasPermission("payments.manage") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/payments`}
                            >
                              {t("Payments")}
                            </Link>
                          )}
                          {hasPermission("reports.view") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/reports`}
                            >
                              {t("Reports")}
                            </Link>
                          )}
                          {hasPermission("business.manage", "business.profile.manage") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/qr`}
                            >
                              {hasPermission("business.manage")
                                ? t("Customer QR")
                                : t("Public profile")}
                            </Link>
                          )}
                          {hasPermission(
                            "business.manage",
                            "inventory.manage",
                            "payments.manage",
                            "reports.view",
                          ) && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/documents`}
                            >
                              {t("Documents")}
                            </Link>
                          )}
                          {hasPermission("menu.view", "menu.manage") && (
                            <Link
                              className="text-sm font-semibold text-[#153d32] hover:underline"
                              href={`/business/${membership.business_id}/menu`}
                            >
                              {t("Menu")}
                            </Link>
                          )}
                        </nav>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-6 rounded-xl border border-dashed border-[#d6ded8] px-5 py-8 text-center">
                <p className="text-sm font-medium">{t("No active workspaces")}</p>
                <p className="mt-1 text-sm text-[#64736a]">
                  {t("Workspaces appear here after business approval.")}
                </p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
