import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type OverviewPageProps = {
  params: Promise<{ businessId: string }>;
};

type Overview = {
  timezone: string;
  revenue_today: number;
  revenue_yesterday: number;
  orders_today: number;
  cancelled_items_today: number;
  unfinished_orders: number;
  delayed_items: number;
  unpaid: { orders: number; amount: number };
  refunds_due: { orders: number; amount: number };
  open_guest_requests: number;
  pending_stock_requests: number;
  pending_purchase_approvals: number;
  awaiting_delivery: number;
  low_stock_count: number;
  expiring_soon_count: number;
  staff_on_duty: { name: string; since: string }[];
  closeouts_today: number;
};

type RestaurantOverview = {
  timezone: string;
  orders_today: number;
  open_orders: number;
  delayed_items: number;
  staff_on_duty: { name: string; since: string }[];
};

type Card = {
  label: string;
  value: string;
  hint?: string;
  attention?: boolean;
  href?: string;
};

export default async function OverviewPage({ params }: OverviewPageProps) {
  const { businessId } = await params;

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
    { data: canViewReports, error: reportPermissionError },
    { data: canViewHotel, error: hotelPermissionError },
    { data: canViewRestaurant, error: restaurantPermissionError },
  ] = await Promise.all([
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "reports.view",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "hotel.view",
    }),
    supabase.rpc("has_business_permission", {
      p_business_id: businessId,
      p_permission_key: "restaurant.view",
    }),
  ]);
  if (reportPermissionError || hotelPermissionError || restaurantPermissionError) {
    console.error(
      "Overview permission check failed:",
      [reportPermissionError, hotelPermissionError, restaurantPermissionError]
        .filter(Boolean)
        .map((error) => error?.message)
        .join("; "),
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Overview access could not be verified. Confirm the latest database migrations are applied.
        </p>
      </main>
    );
  }
  if (!canViewReports && !canViewHotel && !canViewRestaurant) {
    redirect("/dashboard");
  }

  const [
    { data: business, error: businessError },
    { data: overview, error: overviewError },
    { data: settings },
    { data: hotel, error: hotelError },
    { data: restaurant, error: restaurantError },
  ] = await Promise.all([
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    canViewReports
      ? supabase.rpc("manager_overview", { p_business_id: businessId })
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("business_settings")
      .select("currency_code, timezone")
      .eq("business_id", businessId)
      .maybeSingle(),
    canViewHotel
      ? supabase.rpc("hotel_overview", { p_business_id: businessId })
      : Promise.resolve({ data: null, error: null }),
    canViewRestaurant
      ? supabase.rpc("restaurant_overview", { p_business_id: businessId })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (businessError) {
    console.error("Overview business lookup failed:", businessError.message);
  }
  if (!business) {
    notFound();
  }
  if (
    overviewError?.code === "42501" ||
    hotelError?.code === "42501" ||
    restaurantError?.code === "42501"
  ) {
    redirect("/dashboard");
  }
  if (
    (canViewReports && (overviewError || !overview)) ||
    (canViewHotel && hotelError) ||
    (canViewRestaurant && (restaurantError || !restaurant))
  ) {
    console.error(
      "Overview data failed:",
      overviewError?.message ?? hotelError?.message ?? restaurantError?.message,
    );
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          The overview could not be loaded. Refresh and try again.
        </p>
      </main>
    );
  }

  const data = overview as Overview | null;
  const restaurantData = restaurant as RestaurantOverview | null;
  const currency = settings?.currency_code ?? "RWF";
  const money = (value: number) => `${Number(value).toLocaleString()} ${currency}`;
  const base = `/business/${businessId}`;

  const change = data ? data.revenue_today - data.revenue_yesterday : 0;
  const changeText =
    data && data.revenue_yesterday > 0
      ? `${change >= 0 ? "+" : ""}${Math.round((change / data.revenue_yesterday) * 100)}% vs yesterday`
      : data
        ? `Yesterday: ${money(data.revenue_yesterday)}`
        : "";

  const sales: Card[] = data
    ? [
        {
          label: "Revenue today",
          value: money(data.revenue_today),
          hint: changeText,
          href: `${base}/reports`,
        },
        { label: "Orders today", value: String(data.orders_today), href: `${base}/orders` },
        {
          label: "Cancelled items today",
          value: String(data.cancelled_items_today),
          attention: data.cancelled_items_today >= 5,
        },
        {
          label: "Cashier close-outs today",
          value: String(data.closeouts_today),
          href: `${base}/payments`,
        },
      ]
    : [];

  const attention: Card[] = data
    ? [
        {
          label: "Unfinished orders",
          value: String(data.unfinished_orders),
          hint:
            data.delayed_items > 0
              ? `${data.delayed_items} item(s) waiting over 20 min`
              : undefined,
          attention: data.delayed_items > 0,
          href: `${base}/orders`,
        },
        {
          label: "Unpaid balance",
          value: money(data.unpaid.amount),
          hint: `${data.unpaid.orders} order(s)`,
          attention: data.unpaid.orders > 0,
          href: `${base}/payments`,
        },
        {
          label: "Refunds due",
          value: money(data.refunds_due.amount),
          hint: `${data.refunds_due.orders} order(s)`,
          attention: data.refunds_due.orders > 0,
          href: `${base}/payments`,
        },
        {
          label: "Guest requests open",
          value: String(data.open_guest_requests),
          attention: data.open_guest_requests > 0,
          href: `${base}/orders`,
        },
      ]
    : [];

  const stock: Card[] = data
    ? [
        {
          label: "Low stock products",
          value: String(data.low_stock_count),
          attention: data.low_stock_count > 0,
          href: `${base}/inventory`,
        },
        {
          label: "Batches expiring in 7 days",
          value: String(data.expiring_soon_count),
          attention: data.expiring_soon_count > 0,
          href: `${base}/reports`,
        },
        {
          label: "Department stock requests",
          value: String(data.pending_stock_requests),
          hint: "Open or not yet issued",
          attention: data.pending_stock_requests > 0,
          href: `${base}/inventory`,
        },
        {
          label: "Purchases to approve",
          value: String(data.pending_purchase_approvals),
          hint: `${data.awaiting_delivery} awaiting delivery`,
          attention: data.pending_purchase_approvals > 0,
          href: `${base}/purchasing`,
        },
      ]
    : [];

  const hotelData = hotel as {
    enabled: boolean;
    rooms_total: number;
    occupied: number;
    occupancy_percent: number;
    vacant_clean: number;
    vacant_dirty: number;
    out_of_service: number;
    arrivals_today: number;
    departures_today: number;
    in_house: number;
    folio_payments_today: number | null;
    open_maintenance: number;
  } | null;
  const hotelCards: Card[] = hotelData?.enabled
    ? [
        {
          label: "Occupancy",
          value: `${hotelData.occupancy_percent}%`,
          hint: `${hotelData.occupied} of ${hotelData.rooms_total} rooms`,
          href: `${base}/hotel`,
        },
        { label: "Arrivals today", value: String(hotelData.arrivals_today), href: `${base}/hotel` },
        {
          label: "Departures due",
          value: String(hotelData.departures_today),
          hint: `${hotelData.in_house} guests in house`,
          attention: hotelData.departures_today > 0,
          href: `${base}/hotel`,
        },
        {
          label: "Rooms to clean",
          value: String(hotelData.vacant_dirty),
          hint: `${hotelData.out_of_service} out of service`,
          attention: hotelData.vacant_dirty > 0,
          href: `${base}/hotel`,
        },
        ...(hotelData.folio_payments_today !== null
          ? [
              {
                label: "Room payments today",
                value: money(hotelData.folio_payments_today),
                href: `${base}/hotel`,
              },
            ]
          : []),
        {
          label: "Open maintenance",
          value: String(hotelData.open_maintenance),
          attention: hotelData.open_maintenance > 0,
          href: `${base}/hotel`,
        },
      ]
    : [];
  const restaurantCards: Card[] = restaurantData
    ? [
        {
          label: "Orders today",
          value: String(restaurantData.orders_today),
          href: `${base}/orders`,
        },
        {
          label: "Open orders",
          value: String(restaurantData.open_orders),
          attention: restaurantData.open_orders > 0,
          href: `${base}/orders`,
        },
        {
          label: "Delayed items",
          value: String(restaurantData.delayed_items),
          hint: "Waiting over 20 minutes",
          attention: restaurantData.delayed_items > 0,
          href: `${base}/orders`,
        },
      ]
    : [];

  const renderCards = (cards: Card[]) => (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const body = (
          <div
            className={`h-full rounded-xl border bg-white p-5 ${
              card.attention ? "border-[#e8c9a0]" : "border-[#e3e9e4]"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">
              {card.label}
            </p>
            <p
              className={`mt-2 text-2xl font-semibold ${card.attention ? "text-[#9c5b12]" : ""}`}
            >
              {card.value}
            </p>
            {card.hint && <p className="mt-1 text-xs text-[#64736a]">{card.hint}</p>}
          </div>
        );
        return card.href ? (
          <Link className="block transition hover:-translate-y-0.5" href={card.href} key={card.label}>
            {body}
          </Link>
        ) : (
          <div key={card.label}>{body}</div>
        );
      })}
    </div>
  );

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <AutoRefresh seconds={30} />
      <header className="border-b border-[#e3e9e4] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
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
      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">
          Today at a glance
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-sm leading-6 text-[#64736a]">
          {data
            ? `Updates every 30 seconds. Days follow the ${data.timezone} time zone. Highlighted cards need attention.`
            : restaurantData
              ? `Updates every 30 seconds. Days follow the ${restaurantData.timezone} time zone.`
              : `Hotel operations at a glance. Days follow the ${settings?.timezone ?? "business"} time zone.`}
        </p>

        {restaurantData && (
          <>
            <h2 className="mt-8 text-lg font-semibold">Restaurant operations</h2>
            {renderCards(restaurantCards)}
            <div className="mt-8 rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
              <h2 className="text-lg font-semibold">
                Staff on duty ({restaurantData.staff_on_duty.length})
              </h2>
              {restaurantData.staff_on_duty.length ? (
                <ul className="mt-4 divide-y divide-[#edf0ed]">
                  {restaurantData.staff_on_duty.map((person, index) => (
                    <li
                      className="flex justify-between gap-3 py-2 text-sm"
                      key={`${person.name}-${index}`}
                    >
                      <span className="font-medium">{person.name}</span>
                      <span className="text-[#64736a]">
                        since{" "}
                        {new Date(person.since).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: restaurantData.timezone,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#64736a]">Nobody is clocked in right now.</p>
              )}
            </div>
          </>
        )}

        {data && (
          <>
            <h2 className="mt-8 text-lg font-semibold">Sales</h2>
            {renderCards(sales)}

            <h2 className="mt-8 text-lg font-semibold">Needs attention now</h2>
            {renderCards(attention)}

            <h2 className="mt-8 text-lg font-semibold">Stock and purchasing</h2>
            {renderCards(stock)}
          </>
        )}

        {hotelData?.enabled ? (
          <>
            <h2 className="mt-8 text-lg font-semibold">Hotel</h2>
            {renderCards(hotelCards)}
          </>
        ) : !data && !restaurantData ? (
          <p className="mt-8 rounded-xl border border-dashed border-[#d6ded8] bg-white px-5 py-8 text-sm text-[#64736a]">
            Hotel operations are not enabled for this business.
          </p>
        ) : null}

        {data && <div className="mt-8 rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Staff on duty ({data.staff_on_duty.length})</h2>
          {data.staff_on_duty.length ? (
            <ul className="mt-4 divide-y divide-[#edf0ed]">
              {data.staff_on_duty.map((person, index) => (
                <li className="flex justify-between gap-3 py-2 text-sm" key={`${person.name}-${index}`}>
                  <span className="font-medium">{person.name}</span>
                  <span className="text-[#64736a]">
                    since{" "}
                    {new Date(person.since).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: data.timezone,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[#64736a]">Nobody is clocked in right now.</p>
          )}
        </div>}
      </section>
    </main>
  );
}
