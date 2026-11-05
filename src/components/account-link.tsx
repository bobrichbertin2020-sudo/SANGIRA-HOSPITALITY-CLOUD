import { Settings } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AccountMenu } from "@/components/account-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { loadProfileSummary } from "@/lib/settings/summary";

function SettingsFallback() {
  return (
    <Link
      aria-label="Personal settings"
      className="inline-flex size-10 items-center justify-center rounded-lg border border-[#d6ded8] text-[#29483c] hover:bg-[#f7f8f6]"
      href="/settings"
      title="Personal settings"
    >
      <Settings aria-hidden="true" size={18} />
    </Link>
  );
}

async function ProfileMenu() {
  const profile = await loadProfileSummary();
  if (!profile) return <SettingsFallback />;
  return (
    <AccountMenu
      avatarUrl={profile.avatarUrl}
      email={profile.email}
      initials={profile.initials}
      name={profile.name}
      role={
        profile.isPlatformAdmin
          ? "System administrator"
          : (profile.workspaces[0]?.roles[0] ?? null)
      }
    />
  );
}

export function AccountLink() {
  return (
    <div className="flex items-center gap-2">
      <LanguageSwitcher />
      <Suspense fallback={<SettingsFallback />}>
        <ProfileMenu />
      </Suspense>
    </div>
  );
}
