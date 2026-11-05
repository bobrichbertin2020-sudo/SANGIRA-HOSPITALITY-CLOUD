import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/business/[businessId]/payments/receipt/[orderId]/print-button";

export const instant = false;

type BillPageProps = {
  params: Promise<{ businessId: string; reservationId: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata = { title: "Guest bill", robots: { index: false } };

export default async function GuestBillPage({ params }: BillPageProps) {
  const { businessId, reservationId } = await params;
  if (!uuidPattern.test(businessId) || !uuidPattern.test(reservationId)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { data: canFront } = await supabase.rpc("has_business_permission", {
    p_business_id: businessId,
    p_permission_key: "hotel.frontdesk",
  });
  if (!canFront) {
    redirect("/dashboard");
  }

  const [
    { data: business },
    { data: settings },
    { data: stay },
    { data: charges },
    { data: payments },
  ] = await Promise.all([
    supabase.from("businesses").select("name, location").eq("id", businessId).maybeSingle(),
    supabase
      .from("business_settings")
      .select("currency_code")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "id, reservation_code, room_id, guest_name, check_in_date, check_out_date, nightly_rate, status",
      )
      .eq("id", reservationId)
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("folio_charges")
      .select("id, description, amount, created_at")
      .eq("reservation_id", reservationId)
      .eq("business_id", businessId)
      .order("created_at"),
    supabase
      .from("folio_payments")
      .select("id, amount, method, reference, created_at")
      .eq("reservation_id", reservationId)
      .eq("business_id", businessId)
      .order("created_at"),
  ]);

  if (!business || !stay) {
    notFound();
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("room_number, room_type")
    .eq("id", stay.room_id)
    .eq("business_id", businessId)
    .maybeSingle();

  const money = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: settings?.currency_code ?? "RWF",
  });
  const nights = Math.round(
    (Date.parse(stay.check_out_date) - Date.parse(stay.check_in_date)) / 86_400_000,
  );
  const roomTotal = nights * Number(stay.nightly_rate);
  const extras = (charges ?? []).reduce((sum, item) => sum + Number(item.amount), 0);
  const total = roomTotal + extras;
  const paid = (payments ?? []).reduce((sum, item) => sum + Number(item.amount), 0);
  const balance = Math.round((total - paid) * 100) / 100;

  return (
    <main className="mx-auto max-w-md bg-white px-5 py-8 text-sm text-black">
      <div className="text-center">
        <h1 className="text-lg font-semibold">{business.name}</h1>
        {business.location && <p className="text-xs">{business.location}</p>}
        <p className="mt-2 text-xs">Guest bill · {stay.reservation_code}</p>
      </div>

      <dl className="mt-4 space-y-1 text-xs">
        <div className="flex justify-between">
          <dt>Guest</dt>
          <dd>{stay.guest_name}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Room</dt>
          <dd>
            {room?.room_number} {room?.room_type ? `(${room.room_type})` : ""}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Stay</dt>
          <dd>
            {stay.check_in_date} → {stay.check_out_date}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 divide-y divide-dashed divide-gray-300 border-y border-dashed border-gray-300">
        <li className="flex justify-between gap-3 py-1.5">
          <span>
            {nights} night(s) × {money.format(Number(stay.nightly_rate))}
          </span>
          <span>{money.format(roomTotal)}</span>
        </li>
        {(charges ?? []).map((item) => (
          <li className="flex justify-between gap-3 py-1.5" key={item.id}>
            <span>{item.description}</span>
            <span>{money.format(Number(item.amount))}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1">
        <div className="flex justify-between font-semibold">
          <dt>Total</dt>
          <dd>{money.format(total)}</dd>
        </div>
        {(payments ?? []).map((payment) => (
          <div className="flex justify-between text-xs" key={payment.id}>
            <dt className="capitalize">
              Paid · {payment.method.replaceAll("_", " ")} ·{" "}
              {new Date(payment.created_at).toLocaleDateString()}
            </dt>
            <dd>{money.format(Number(payment.amount))}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-gray-300 pt-1 font-semibold">
          <dt>{balance > 0 ? "Balance due" : "Balance"}</dt>
          <dd>{money.format(Math.max(balance, 0))}</dd>
        </div>
      </dl>

      <p className="mt-6 text-center text-xs">Thank you for staying with us.</p>
      <div className="mt-6 flex justify-center">
        <PrintButton label="Print bill" />
      </div>
    </main>
  );
}
