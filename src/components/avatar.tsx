import type { ProfileSummary } from "@/lib/settings/summary";

export function Avatar({
  profile,
  className = "size-10 text-sm",
}: {
  profile: Pick<ProfileSummary, "avatarUrl" | "initials" | "name">;
  className?: string;
}) {
  return profile.avatarUrl ? (
    // Signed, short-lived storage URL; next/image would need remote host configuration.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={`${profile.name} profile photo`}
      className={`shrink-0 rounded-full object-cover ${className}`}
      src={profile.avatarUrl}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#153d32] font-semibold text-white ${className}`}
    >
      {profile.initials}
    </span>
  );
}
