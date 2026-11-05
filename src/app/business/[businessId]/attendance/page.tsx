import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { clockIn, clockOut } from "@/app/business/[businessId]/attendance/actions";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type AttendancePageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatDuration(start: string, end: string | null) {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default async function AttendancePage({ params, searchParams }: AttendancePageProps) {
  const { businessId } = await params;
  if (!uuidPattern.test(businessId)) {
    notFound();
  }
  const { notice: rawNotice } = await searchParams;
  const notice = typeof rawNotice === "string" ? rawNotice.slice(0, 200) : null;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect("/sign-in");
  }

  const [
    { data: isMember, error: memberError },
    { data: canManage },
    { data: business },
  ] = await Promise.all([
    supabase.rpc("is_active_business_member", { p_business_id: businessId }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "shifts.manage",
    }),
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
  ]);

  if (memberError) {
    console.error("Attendance access check failed:", memberError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Attendance could not be loaded. Confirm the attendance migration is deployed.
        </p>
      </main>
    );
  }
  if (!isMember || !business) {
    redirect("/dashboard");
  }

  const recordQuery = supabase
    .from("attendance_records")
    .select("id, user_id, clock_in_at, clock_out_at")
    .eq("business_id", businessId)
    .order("clock_in_at", { ascending: false })
    .limit(50);
  const { data: records, error: recordsError } = canManage
    ? await recordQuery
    : await recordQuery.eq("user_id", user.id);

  if (recordsError) {
    console.error("Attendance records failed:", recordsError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Attendance could not be loaded. Refresh and try again.
        </p>
      </main>
    );
  }

  const userIds = [...new Set((records ?? []).map((record) => record.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
  const isClockedIn = (records ?? []).some(
    (record) => record.user_id === user.id && record.clock_out_at === null,
  );
  const dateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

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
      <section className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
        <Link className="text-sm font-semibold text-[#153d32] hover:underline" href="/dashboard">
          ← Dashboard
        </Link>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          {business.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          Clock in when your shift starts and clock out when it ends. Times are recorded by the server.
        </p>

        {notice && (
          <p role="alert" className="mt-4 rounded-lg border border-[#f0c9c3] bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
            {notice}
          </p>
        )}

        <form action={isClockedIn ? clockOut : clockIn} className="mt-6">
          <input name="businessId" type="hidden" value={businessId} />
          <button className="rounded-lg bg-[#153d32] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#205443]">
            {isClockedIn ? "Clock out" : "Clock in"}
          </button>
        </form>

        <h2 className="mt-10 font-semibold">{canManage ? "Recent staff attendance" : "Your recent attendance"}</h2>
        <ul className="mt-3 divide-y divide-[#eef2ef] rounded-xl border border-[#e3e9e4] bg-white text-sm">
          {(records ?? []).length === 0 && (
            <li className="px-5 py-4 text-[#64736a]">No attendance recorded yet.</li>
          )}
          {(records ?? []).map((record) => (
            <li key={record.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
              <span className="font-medium">
                {canManage
                  ? (names.get(record.user_id) ?? record.user_id.slice(0, 8))
                  : "You"}
              </span>
              <span className="text-[#64736a]">
                {dateTime.format(new Date(record.clock_in_at))} →{" "}
                {record.clock_out_at
                  ? dateTime.format(new Date(record.clock_out_at))
                  : "on shift"}{" "}
                ({formatDuration(record.clock_in_at, record.clock_out_at)})
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
