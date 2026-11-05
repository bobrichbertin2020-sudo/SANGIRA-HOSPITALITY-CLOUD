import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";
import { AccountLink } from "@/components/account-link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";
import {
  cancelReservation,
  checkInGuest,
  markRoomClean,
  resolveMaintenance,
} from "./actions";
import {
  ActionButton,
  AddRoomForm,
  DepositForm,
  FolioForms,
  HotelModuleToggle,
  MaintenanceForm,
  ReservationForm,
} from "./forms";

export const instant = false;

type HotelPageProps = { params: Promise<{ businessId: string }> };

const roomStyles: Record<string, { label: string; tone: string }> = {
  vacant_clean: { label: "Ready", tone: "bg-[#edf6ef] text-[#285c3e]" },
  vacant_dirty: { label: "Needs cleaning", tone: "bg-[#fff6e5] text-[#8a5a12]" },
  occupied: { label: "Occupied", tone: "bg-[#eaf1fb] text-[#2b4f86]" },
  out_of_service: { label: "Out of service", tone: "bg-[#fff1ee] text-[#9c392d]" },
};

const cardClass = "rounded-2xl border border-[#e3e9e4] bg-white p-6 sm:p-8";

export default async function HotelPage({ params }: HotelPageProps) {
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

  const perm = (key: string) =>
    supabase.rpc("has_business_permission", { p_business_id: businessId, p_permission_key: key });

  const [
    { data: canView, error: viewError },
    { data: canFront },
    { data: canHousekeeping },
    { data: canManage },
    { data: canBusiness },
    { data: business },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    perm("hotel.view"),
    perm("hotel.frontdesk"),
    perm("hotel.housekeeping"),
    perm("hotel.manage"),
    perm("business.manage"),
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    supabase
      .from("business_settings")
      .select("currency_code, timezone, hotel_enabled")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  if (!business) {
    notFound();
  }
  if (settingsError || viewError) {
    console.error("Hotel setup check failed:", (settingsError ?? viewError)?.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          The hotel module could not be loaded. Confirm the latest database migrations are applied.
        </p>
      </main>
    );
  }
  if (!canView && !canBusiness) {
    redirect("/dashboard");
  }

  const header = (
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
  );

  if (!settings?.hotel_enabled) {
    return (
      <main className="min-h-screen bg-[#f7f8f6]">
        {header}
        <section className="mx-auto max-w-3xl px-5 py-12">
          <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
            ← Dashboard
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">{business.name} · Hotel</h1>
          <div className={`${cardClass} mt-6`}>
            <p className="text-sm leading-6 text-[#64736a]">
              The hotel module is off. Turn it on if this business has rooms: you get room
              management, reservations, check-in and check-out, guest bills, housekeeping and
              maintenance, plus Front desk and Housekeeping departments for staff.
            </p>
            {canBusiness ? (
              <div className="mt-5">
                <HotelModuleToggle businessId={businessId} enabled={false} />
              </div>
            ) : (
              <p className="mt-4 text-sm font-medium">Ask the business owner to turn it on.</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  const [
    { data: rooms, error: roomsError },
    { data: reservations, error: reservationsError },
    { data: charges },
    { data: payments },
    { data: maintenance, error: maintenanceError },
  ] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number, room_type, capacity, nightly_rate, status")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("room_number"),
    canFront
      ? supabase
          .from("reservations")
          .select(
            "id, reservation_code, room_id, guest_name, guest_phone, guest_count, check_in_date, check_out_date, nightly_rate, status, notes",
          )
          .eq("business_id", businessId)
          .in("status", ["reserved", "checked_in"])
          .order("check_in_date")
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    canFront
      ? supabase.from("folio_charges").select("reservation_id, description, amount").eq("business_id", businessId)
      : Promise.resolve({ data: [] }),
    canFront
      ? supabase.from("folio_payments").select("reservation_id, amount").eq("business_id", businessId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("maintenance_requests")
      .select("id, room_id, description, priority, blocks_room, status, created_at")
      .eq("business_id", businessId)
      .neq("status", "resolved")
      .order("created_at", { ascending: false }),
  ]);

  const loadError = roomsError ?? reservationsError ?? maintenanceError;
  if (loadError) {
    console.error("Hotel data could not be loaded:", loadError.message);
    return (
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p role="alert" className="rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]">
          Hotel data could not be loaded. Confirm the hotel migration is deployed.
        </p>
      </main>
    );
  }

  const currency = settings.currency_code ?? "RWF";
  const money = (value: number) => `${Number(value).toLocaleString()} ${currency}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date());

  const roomMap = new Map((rooms ?? []).map((room) => [room.id, room]));
  const stays = reservations ?? [];
  const arrivals = stays.filter((stay) => stay.status === "reserved" && stay.check_in_date <= today);
  const upcoming = stays.filter((stay) => stay.status === "reserved" && stay.check_in_date > today);
  const inHouse = stays.filter((stay) => stay.status === "checked_in");

  const nights = (stay: (typeof stays)[number]) =>
    Math.round(
      (Date.parse(stay.check_out_date) - Date.parse(stay.check_in_date)) / 86_400_000,
    );
  const chargesFor = (id: string) => (charges ?? []).filter((item) => item.reservation_id === id);
  const folio = (stay: (typeof stays)[number]) => {
    const extras = chargesFor(stay.id).reduce((sum, item) => sum + Number(item.amount), 0);
    const paid = (payments ?? [])
      .filter((item) => item.reservation_id === stay.id)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const total = nights(stay) * Number(stay.nightly_rate) + extras;
    return { total, paid, balance: Math.round((total - paid) * 100) / 100 };
  };

  const counts = Object.fromEntries(
    Object.keys(roomStyles).map((key) => [
      key,
      (rooms ?? []).filter((room) => room.status === key).length,
    ]),
  );
  const departures = inHouse.filter((stay) => stay.check_out_date <= today);

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <AutoRefresh seconds={30} />
      {header}
      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        <Link href="/dashboard" className="text-sm font-semibold text-[#153d32]">
          ← Dashboard
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-[#a46f38]">Hotel</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-2 text-sm text-[#64736a]">
          Today is {today}. Updates every 30 seconds.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(roomStyles).map(([key, style]) => (
            <div className="rounded-xl border border-[#e3e9e4] bg-white p-5" key={key}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#85938a]">{style.label}</p>
              <p className="mt-2 text-2xl font-semibold">{counts[key] ?? 0}</p>
            </div>
          ))}
        </div>

        <div className={`${cardClass} mt-8`}>
          <h2 className="text-lg font-semibold">Rooms</h2>
          {rooms?.length ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rooms.map((room) => {
                const style = roomStyles[room.status];
                const guest = inHouse.find((stay) => stay.room_id === room.id);
                return (
                  <li className="rounded-xl border border-[#e3e9e4] p-4" key={room.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">Room {room.room_number}</p>
                        <p className="text-xs text-[#64736a]">
                          {room.room_type} · sleeps {room.capacity} · {money(Number(room.nightly_rate))}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style?.tone}`}>
                        {style?.label}
                      </span>
                    </div>
                    {guest && <p className="mt-2 text-xs text-[#64736a]">Guest: {guest.guest_name}</p>}
                    {room.status === "vacant_dirty" && (canHousekeeping || canManage) && (
                      <div className="mt-3">
                        <ActionButton action={markRoomClean} businessId={businessId} id={room.id} label="Mark clean" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[#64736a]">No rooms yet.{canManage ? " Add your first room below." : ""}</p>
          )}
        </div>

        {canFront && (
          <div className="mt-8 grid gap-8 xl:grid-cols-2">
            <div className={cardClass}>
              <h2 className="text-lg font-semibold">Arriving today ({arrivals.length})</h2>
              {arrivals.length ? (
                <ul className="mt-4 divide-y divide-[#edf0ed]">
                  {arrivals.map((stay) => {
                    const room = roomMap.get(stay.room_id);
                    return (
                      <li className="py-3" key={stay.id}>
                        <p className="text-sm font-medium">
                          {stay.guest_name} · Room {room?.room_number}
                        </p>
                        <p className="text-xs text-[#64736a]">
                          {stay.check_in_date} → {stay.check_out_date} · {stay.guest_count} guest(s)
                          {stay.guest_phone ? ` · ${stay.guest_phone}` : ""}
                          {room && room.status !== "vacant_clean" ? ` · room is ${roomStyles[room.status]?.label.toLowerCase()}` : ""}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <ActionButton action={checkInGuest} businessId={businessId} id={stay.id} label="Check in" />
                          <ActionButton action={cancelReservation} businessId={businessId} danger id={stay.id} label="Cancel" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[#64736a]">No arrivals waiting.</p>
              )}
            </div>

            <div className={cardClass}>
              <h2 className="text-lg font-semibold">New reservation</h2>
              {rooms?.length ? (
                <ReservationForm
                  businessId={businessId}
                  rooms={(rooms ?? []).map((room) => ({
                    id: room.id,
                    room_number: room.room_number,
                    room_type: room.room_type,
                    nightly_rate: Number(room.nightly_rate),
                    capacity: room.capacity,
                  }))}
                  today={today}
                />
              ) : (
                <p className="mt-3 text-sm text-[#64736a]">Add rooms first.</p>
              )}
            </div>
          </div>
        )}

        {canFront && (
          <div className={`${cardClass} mt-8`}>
            <h2 className="text-lg font-semibold">
              In house ({inHouse.length}){departures.length ? ` · ${departures.length} due to leave` : ""}
            </h2>
            {inHouse.length ? (
              <ul className="mt-4 space-y-5">
                {inHouse.map((stay) => {
                  const room = roomMap.get(stay.room_id);
                  const bill = folio(stay);
                  const due = stay.check_out_date <= today;
                  return (
                    <li className="rounded-xl border border-[#e3e9e4] p-4" key={stay.id}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">
                            {stay.guest_name} · Room {room?.room_number}
                          </p>
                          <p className="text-xs text-[#64736a]">
                            {stay.check_in_date} → {stay.check_out_date} ({nights(stay)} night(s))
                            {due ? " · due to leave today" : ""}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p>Bill {money(bill.total)}</p>
                          <p className="text-xs text-[#64736a]">Paid {money(bill.paid)}</p>
                          <p className={`font-semibold ${bill.balance > 0 ? "text-[#9c392d]" : "text-[#285c3e]"}`}>
                            Balance {money(bill.balance)}
                          </p>
                        </div>
                      </div>
                      {chargesFor(stay.id).length > 0 && (
                        <ul className="mt-2 text-xs text-[#64736a]">
                          {chargesFor(stay.id).map((item, index) => (
                            <li key={`${item.description}-${index}`}>
                              + {item.description}: {money(Number(item.amount))}
                            </li>
                          ))}
                        </ul>
                      )}
                      <FolioForms
                        balance={bill.balance}
                        businessId={businessId}
                        canWaive={Boolean(canManage)}
                        checkOut={stay.check_out_date}
                        reservationId={stay.id}
                      />
                      <Link
                        className="mt-2 inline-block text-xs font-semibold text-[#153d32] underline"
                        href={`/business/${businessId}/hotel/bill/${stay.id}`}
                      >
                        Print guest bill
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[#64736a]">No guests are checked in.</p>
            )}
          </div>
        )}

        {canFront && upcoming.length > 0 && (
          <div className={`${cardClass} mt-8`}>
            <h2 className="text-lg font-semibold">Upcoming reservations ({upcoming.length})</h2>
            <ul className="mt-4 divide-y divide-[#edf0ed]">
              {upcoming.map((stay) => (
                <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={stay.id}>
                  <div>
                    <p className="text-sm font-medium">
                      {stay.guest_name} · Room {roomMap.get(stay.room_id)?.room_number}
                    </p>
                    <p className="text-xs text-[#64736a]">
                      {stay.check_in_date} → {stay.check_out_date} · Deposit paid {money(folio(stay).paid)}
                    </p>
                  </div>
                  <ActionButton action={cancelReservation} businessId={businessId} danger id={stay.id} label="Cancel" />
                  <DepositForm businessId={businessId} reservationId={stay.id} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 grid gap-8 xl:grid-cols-2">
          <div className={cardClass}>
            <h2 className="text-lg font-semibold">Maintenance</h2>
            {maintenance?.length ? (
              <ul className="mt-4 divide-y divide-[#edf0ed]">
                {maintenance.map((request) => (
                  <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={request.id}>
                    <div>
                      <p className="text-sm font-medium">
                        Room {roomMap.get(request.room_id)?.room_number}: {request.description}
                      </p>
                      <p className="text-xs capitalize text-[#64736a]">
                        {request.priority}
                        {request.blocks_room ? " · room out of service" : ""}
                      </p>
                    </div>
                    {(canHousekeeping || canManage) && (
                      <ActionButton action={resolveMaintenance} businessId={businessId} id={request.id} label="Mark fixed" />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[#64736a]">No open issues.</p>
            )}
            {rooms?.length ? <MaintenanceForm businessId={businessId} rooms={rooms} /> : null}
          </div>

          {canManage && (
            <div className={cardClass}>
              <h2 className="text-lg font-semibold">Add a room</h2>
              <AddRoomForm businessId={businessId} />
              {canBusiness && (
                <div className="mt-6 border-t border-[#edf0ed] pt-4">
                  <HotelModuleToggle businessId={businessId} enabled />
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
