import {
  ArrowLeft,
  Bell,
  Camera,
  IdCard,
  Lock,
  MonitorSmartphone,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { signOut } from "@/app/sign-in/actions";
import {
  AppearanceForm,
  DeletionPanel,
  NotificationsForm,
  PasswordForm,
  PhotoForm,
  ProfileForm,
  RecoveryButton,
  SignOutOthers,
  ThemeSync,
} from "@/app/settings/forms";
import { roleLabels, type MyProfile, type Theme } from "@/lib/settings/options";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const instant = false;
export const metadata = { title: "Personal settings" };

const sections = [
  { id: "personal", label: "Personal information", Icon: UserRound },
  { id: "photo", label: "Profile photo", Icon: Camera },
  { id: "security", label: "Security & password", Icon: Lock },
  { id: "preferences", label: "Account preferences", Icon: SlidersHorizontal },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "account", label: "Account information", Icon: IdCard },
  { id: "sessions", label: "Session management", Icon: MonitorSmartphone },
] as const;

async function Section({
  id,
  title,
  description,
  children,
}: {
  id: (typeof sections)[number]["id"];
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = await getT();
  const Icon = sections.find((section) => section.id === id)!.Icon;
  return (
    <section className="scroll-mt-6 rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8" id={id}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f4ee] text-[#153d32]">
          <Icon aria-hidden="true" size={18} />
        </span>
        <div>
          <h2 className="text-lg font-semibold">{t(title)}</h2>
          <p className="mt-1 text-sm text-[#64736a]">{t(description)}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function describeDevice(userAgent: string | null, t: (text: string) => string) {
  if (!userAgent) return t("Unknown device");
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return system ? `${browser} ${t("on")} ${system}` : browser;
}

function makeFormatDate(locale: string, t: (text: string) => string) {
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return (value: string | number | null | undefined) => {
    if (!value) return t("Not available");
    const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
    return `${dateTime.format(date)} UTC`;
  };
}

export default async function SettingsPage() {
  await connection();
  const { t, locale } = await getT();
  const formatDate = makeFormatDate(locale === "rw" ? "en" : locale, t);
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const [
    { data: profile, error: profileError },
    { data: memberships },
    { data: isPlatformAdmin },
    { data: deletion },
    { data: claimsData },
    requestHeaders,
  ] = await Promise.all([
    supabase.rpc("get_my_profile").maybeSingle<MyProfile>(),
    supabase
      .from("business_memberships")
      .select("id, status, businesses(name, business_code), membership_roles(role_key)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.rpc("is_platform_admin"),
    supabase
      .from("account_deletion_requests")
      .select("requested_at")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle(),
    supabase.auth.getClaims(),
    headers(),
  ]);

  if (profileError || !profile) {
    if (profileError) console.error("Unable to load profile:", profileError.message);
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          {t("Your settings could not be loaded. Confirm the personal settings migration is deployed, then refresh.")}
        </p>
      </main>
    );
  }

  const membershipIds = (memberships ?? []).map((membership) => membership.id);
  const { data: assignments } = membershipIds.length
    ? await supabase
        .from("membership_departments")
        .select("membership_id, department_id")
        .in("membership_id", membershipIds)
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

  const claims = claimsData?.claims;
  const initials = `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase();
  const theme = (profile.theme ?? "system") as Theme;

  const info: [string, ReactNode][] = [
    [t("User ID"), <code className="break-all text-xs" key="id">{user.id}</code>],
    [t("Account created"), formatDate(user.created_at)],
    [t("Account status"), t("Active")],
    [
      t("Email verification"),
      user.email_confirmed_at
        ? t("Verified on {date}", { date: formatDate(user.email_confirmed_at) })
        : t("Not verified"),
    ],
    ...(isPlatformAdmin
      ? ([[t("Platform role"), t("System administrator")]] as [string, ReactNode][])
      : []),
  ];

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <ThemeSync theme={theme} />
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo href="/dashboard" />
          <form action={signOut}>
            <button className="rounded-lg border border-[#d6ded8] px-4 py-2 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
              {t("Sign out")}
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <Link className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#153d32] hover:underline" href="/dashboard">
          <ArrowLeft aria-hidden="true" size={16} />
          {t("Dashboard")}
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">{t("Personal settings")}</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          {t("Manage your own account. Your role, permissions and business access are controlled by your business managers.")}
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_1fr]">
          <nav aria-label={t("Settings sections")} className="lg:sticky lg:top-6 lg:self-start">
            <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {sections.map(({ id, label, Icon }) => (
                <li className="shrink-0" key={id}>
                  <a
                    className="flex items-center gap-2.5 whitespace-nowrap rounded-lg border border-[#e3e9e4] bg-white px-3.5 py-2.5 text-sm font-medium text-[#29483c] hover:bg-[#e8f4ee] lg:border-transparent lg:bg-transparent"
                    href={`#${id}`}
                  >
                    <Icon aria-hidden="true" size={16} />
                    {t(label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-6">
            <Section description="Your name and contact details." id="personal" title="Personal information">
              <ProfileForm
                values={{
                  firstName: profile.first_name ?? (profile.full_name ?? "").split(" ")[0] ?? "",
                  lastName: profile.last_name ?? (profile.full_name ?? "").split(" ").slice(1).join(" "),
                  username: profile.username ?? "",
                  email: user.email ?? "",
                  phone: profile.phone ?? "",
                  address: profile.address ?? "",
                  language: profile.language ?? "en",
                }}
              />
            </Section>

            <Section description="Upload, replace or remove your photograph." id="photo" title="Profile photo">
              <PhotoForm avatarUrl={avatarUrl} initials={initials} />
            </Section>

            <Section description="Change your password or recover access." id="security" title="Security & password">
              <PasswordForm />
              <div className="mt-8 border-t border-[#edf0ed] pt-6">
                <h3 className="text-sm font-semibold">{t("Forgot your current password?")}</h3>
                <p className="mb-3 mt-1 text-sm text-[#64736a]">
                  {t("We can email a secure link to {email} to set a new one.", { email: user.email ?? "" })}
                </p>
                <RecoveryButton />
              </div>
            </Section>

            <Section description="Theme and language." id="preferences" title="Account preferences">
              <AppearanceForm language={profile.language ?? "en"} theme={theme} />
            </Section>

            <Section description="Choose what you hear about, and how." id="notifications" title="Notifications">
              <NotificationsForm
                values={{
                  email_order_updates: profile.email_order_updates,
                  email_stock_alerts: profile.email_stock_alerts,
                  email_payment_alerts: profile.email_payment_alerts,
                  inapp_order_updates: profile.inapp_order_updates,
                  inapp_stock_alerts: profile.inapp_stock_alerts,
                  inapp_payment_alerts: profile.inapp_payment_alerts,
                }}
              />
            </Section>

            <Section
              description="Read-only. Only your business managers or an administrator can change these."
              id="account"
              title="Account information"
            >
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                {info.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">{label}</dt>
                    <dd className="mt-1">{value}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mt-8 text-sm font-semibold">{t("Business assignments")}</h3>
              {memberships?.length ? (
                <ul className="mt-3 divide-y divide-[#edf0ed] rounded-xl border border-[#e3e9e4]">
                  {memberships.map((membership) => {
                    const business = Array.isArray(membership.businesses)
                      ? membership.businesses[0]
                      : membership.businesses;
                    const roles = (membership.membership_roles ?? []).map(
                      (role) => t(roleLabels[role.role_key] ?? role.role_key),
                    );
                    const names = (assignments ?? [])
                      .filter((item) => item.membership_id === membership.id)
                      .map((item) => departmentNames.get(item.department_id))
                      .filter(Boolean);
                    return (
                      <li className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-4" key={membership.id}>
                        <div>
                          <p className="text-xs text-[#85938a]">{t("Business")}</p>
                          <p className="font-medium">{business?.name ?? t("Business")}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#85938a]">{t("Role")}</p>
                          <p>{roles.join(", ") || t("None")}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#85938a]">{t("Department")}</p>
                          <p>{names.map((name) => t(String(name))).join(", ") || t("None")}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#85938a]">{t("Status")}</p>
                          <p className="capitalize">{t(membership.status)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[#64736a]">{t("You are not assigned to a business yet.")}</p>
              )}
            </Section>

            <Section description="Where you are signed in, and account removal." id="sessions" title="Session management">
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold                   uppercase tracking-wide text-[#85938a]">{t("This device")}</dt>
                                    <dd className="mt-1">{describeDevice(requestHeaders.get("user-agent"), t)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">{t("Last sign-in")}</dt>
                  <dd className="mt-1">{formatDate(user.last_sign_in_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">{t("Current session started")}</dt>
                  <dd className="mt-1">{formatDate(claims?.iat)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">{t("Access refreshes by")}</dt>
                  <dd className="mt-1">{formatDate(claims?.exp)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm text-[#64736a]">
                {t("Other devices are not listed individually, but you can sign all of them out at once.")}
              </p>
              <div className="mt-4 flex flex-wrap items-start gap-3">
                <SignOutOthers />
                <form action={signOut}>
                  <button className="rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]">
                    {t("Sign out of this device")}
                  </button>
                </form>
              </div>
              <div className="mt-8 rounded-xl border border-[#e8c9c3] p-5">
                <h3 className="text-sm font-semibold                 text-[#9c392d]">{t("Delete account")}</h3>
                <p className="mb-4 mt-1 text-sm text-[#64736a]">
                                  {t("Submit a request for an administrator to review. Business records you created are retained.")}
                </p>
                <DeletionPanel
                  pendingSince={deletion ? formatDate(deletion.requested_at) : null}
                />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}
