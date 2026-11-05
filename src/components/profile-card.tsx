import { BadgeCheck, MailWarning, Pencil, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { getT } from "@/lib/i18n/server";
import type { ProfileSummary } from "@/lib/settings/summary";

export async function ProfileCard({ profile }: { profile: ProfileSummary }) {
  const { t } = await getT();
  const primary = profile.workspaces[0];
  const nudges = [
    !profile.avatarUrl && t("Add a profile photo"),
    !profile.hasPhone && t("Add a phone number"),
  ].filter(Boolean) as string[];

  return (
    <section
      aria-label={t("Your profile")}
      className="mt-8 rounded-2xl border border-[#e3e9e4] bg-white p-5 sm:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <Avatar className="size-20 text-2xl" profile={profile} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{profile.name}</h2>
          <p className="mt-0.5 truncate text-sm text-[#64736a]">{profile.email}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.isPlatformAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f4ee] px-3 py-1 text-xs font-semibold text-[#285c3e]">
                <ShieldCheck aria-hidden="true" size={13} /> {t("System administrator")}
              </span>
            )}
            {primary?.roles.map((role) => (
              <span
                className="rounded-full bg-[#e8f4ee] px-3 py-1 text-xs font-semibold text-[#285c3e]"
                key={role}
              >
                {t(role)}
              </span>
            ))}
            {primary?.departments.map((department) => (
              <span
                className="rounded-full bg-[#f2f4f2] px-3 py-1 text-xs font-semibold text-[#53635a]"
                key={department}
              >
                {t(department)}
              </span>
            ))}
            {profile.emailVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#edf6ef] px-3 py-1 text-xs font-semibold text-[#285c3e]">
                <BadgeCheck aria-hidden="true" size={13} /> {t("Email verified")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fff9ed] px-3 py-1 text-xs font-semibold text-[#8a5a14]">
                <MailWarning aria-hidden="true" size={13} /> {t("Email not verified")}
              </span>
            )}
            {profile.deletionPending && (
              <span className="rounded-full bg-[#fff1ee] px-3 py-1 text-xs font-semibold text-[#9c392d]">
                {t("Deletion requested")}
              </span>
            )}
          </div>
          {primary && (
            <p className="mt-3 text-sm text-[#64736a]">
              {primary.business}
              {profile.workspaces.length > 1 &&
                ` ${t("and {count} more", { count: profile.workspaces.length - 1 })}`}
            </p>
          )}
        </div>
        <div className="flex gap-2 sm:flex-col">
          <Link
            className="inline-flex items-center gap-2 rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#205443]"
            href="/settings#personal"
          >
            <Pencil aria-hidden="true" size={15} /> {t("Edit profile")}
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-[#d6ded8] px-4 py-2.5 text-sm font-semibold text-[#29483c] hover:bg-[#f7f8f6]"
            href="/settings"
          >
            <Settings aria-hidden="true" size={15} /> {t("Settings")}
          </Link>
        </div>
      </div>
      {nudges.length > 0 && (
        <p className="mt-5 rounded-lg bg-[#fff9ed] px-4 py-2.5 text-sm text-[#8a5a14]">
          {t("Complete your profile:")}{" "}
          <Link className="font-semibold underline" href="/settings#photo">
            {nudges.join(" · ")}
          </Link>
        </p>
      )}
    </section>
  );
}
