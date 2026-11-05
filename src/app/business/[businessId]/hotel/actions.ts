"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type HotelActionState = { error?: string; success?: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

async function getClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/sign-in");
  }
  return supabase;
}

function fail(error: { code?: string; message: string }, fallback: string): HotelActionState {
  console.error("Hotel action failed:", error.message);
  if (error.code === "42501") {
    return { error: error.message.startsWith("Only a manager") ? error.message : "You do not have permission to do that." };
  }
  if (error.code === "22023" || error.code === "23505") {
    return {
      error:
        error.code === "23505"
          ? "That room number already exists."
          : error.message,
    };
  }
  return { error: fallback };
}

function done(businessId: string, success: string): HotelActionState {
  revalidatePath(`/business/${encodeURIComponent(businessId)}/hotel`);
  return { success };
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function setHotelModule(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  if (!uuidPattern.test(businessId)) {
    return { error: "Invalid request." };
  }
  const supabase = await getClient();
  const { error } = await supabase.rpc("set_hotel_module", {
    p_business_id: businessId,
    p_enabled: text(formData, "enabled") === "true",
  });
  if (error) {
    return fail(error, "The hotel module could not be changed. Confirm the hotel migration is deployed.");
  }
  return done(businessId, "Hotel module updated.");
}

export async function createRoom(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const roomNumber = text(formData, "roomNumber");
  const roomType = text(formData, "roomType");
  const capacity = Number(formData.get("capacity") ?? 0);
  const rate = Number(formData.get("rate") ?? -1);

  if (
    !uuidPattern.test(businessId) ||
    roomNumber.length < 1 ||
    roomNumber.length > 20 ||
    roomType.length < 2 ||
    roomType.length > 60 ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 20 ||
    !Number.isFinite(rate) ||
    rate < 0
  ) {
    return { error: "Enter a room number, type, capacity and nightly rate." };
  }

  const supabase = await getClient();
  const { error } = await supabase.rpc("create_room", {
    p_business_id: businessId,
    p_room_number: roomNumber,
    p_room_type: roomType,
    p_capacity: capacity,
    p_nightly_rate: Math.round(rate * 100) / 100,
  });
  if (error) {
    return fail(error, "The room could not be added.");
  }
  return done(businessId, "Room added.");
}

export async function createReservation(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const roomId = text(formData, "roomId");
  const guestName = text(formData, "guestName");
  const guestPhone = text(formData, "guestPhone");
  const guests = Number(formData.get("guests") ?? 0);
  const checkIn = text(formData, "checkIn");
  const checkOut = text(formData, "checkOut");
  const notes = text(formData, "notes");

  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(roomId) ||
    guestName.length < 2 ||
    guestName.length > 120 ||
    guestPhone.length > 40 ||
    !Number.isInteger(guests) ||
    guests < 1 ||
    !datePattern.test(checkIn) ||
    !datePattern.test(checkOut) ||
    notes.length > 500
  ) {
    return { error: "Enter the guest name, room, guests and dates." };
  }

  const supabase = await getClient();
  const { error } = await supabase.rpc("create_reservation", {
    p_business_id: businessId,
    p_room_id: roomId,
    p_guest_name: guestName,
    p_guest_phone: guestPhone || null,
    p_guest_count: guests,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_notes: notes || null,
  });
  if (error) {
    return fail(error, "The reservation could not be saved.");
  }
  return done(businessId, "Reservation saved.");
}

// One-click actions that only need the record id.
function simpleAction(rpc: string, idParam: string, success: string, fallback: string) {
  return async (
    _previous: HotelActionState,
    formData: FormData,
  ): Promise<HotelActionState> => {
    const businessId = text(formData, "businessId");
    const id = text(formData, "id");
    if (!uuidPattern.test(businessId) || !uuidPattern.test(id)) {
      return { error: "Invalid request." };
    }
    const supabase = await getClient();
    const { error } = await supabase.rpc(rpc as never, { [idParam]: id } as never);
    if (error) {
      return fail(error, fallback);
    }
    return done(businessId, success);
  };
}

export async function cancelReservation(
  previous: HotelActionState,
  formData: FormData,
) {
  return simpleAction("cancel_reservation", "p_reservation_id", "Reservation cancelled.", "Could not cancel.")(previous, formData);
}

export async function checkInGuest(previous: HotelActionState, formData: FormData) {
  return simpleAction("check_in_guest", "p_reservation_id", "Guest checked in.", "Could not check in.")(previous, formData);
}

export async function markRoomClean(previous: HotelActionState, formData: FormData) {
  return simpleAction("mark_room_clean", "p_room_id", "Room marked clean.", "Could not update the room.")(previous, formData);
}

export async function resolveMaintenance(previous: HotelActionState, formData: FormData) {
  return simpleAction("resolve_maintenance", "p_request_id", "Issue resolved.", "Could not resolve.")(previous, formData);
}

export async function checkOutGuest(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const id = text(formData, "id");
  if (!uuidPattern.test(businessId) || !uuidPattern.test(id)) {
    return { error: "Invalid request." };
  }
  const supabase = await getClient();
  const { error } = await supabase.rpc("check_out_guest", {
    p_reservation_id: id,
    p_allow_unpaid: text(formData, "allowUnpaid") === "on",
  });
  if (error) {
    return fail(error, "Could not check out.");
  }
  return done(businessId, "Guest checked out. The room needs cleaning.");
}

export async function addFolioCharge(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const id = text(formData, "id");
  const description = text(formData, "description");
  const amount = Number(formData.get("amount") ?? 0);
  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(id) ||
    description.length < 2 ||
    description.length > 160 ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return { error: "Enter a description and an amount." };
  }
  const supabase = await getClient();
  const { error } = await supabase.rpc("add_folio_charge", {
    p_reservation_id: id,
    p_description: description,
    p_amount: Math.round(amount * 100) / 100,
  });
  if (error) {
    return fail(error, "The charge could not be added.");
  }
  return done(businessId, "Charge added to the guest bill.");
}

export async function recordFolioPayment(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const id = text(formData, "id");
  const method = text(formData, "method");
  const reference = text(formData, "reference");
  const amount = Number(formData.get("amount") ?? 0);
  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(id) ||
    !["cash", "mobile_money", "card", "bank"].includes(method) ||
    reference.length > 120 ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return { error: "Enter an amount and payment method." };
  }
  const supabase = await getClient();
  const { error } = await supabase.rpc("record_folio_payment", {
    p_reservation_id: id,
    p_amount: Math.round(amount * 100) / 100,
    p_method: method,
    p_reference: reference || null,
  });
  if (error) {
    return fail(error, "The payment could not be recorded.");
  }
  return done(businessId, "Payment recorded.");
}

export async function changeCheckoutDate(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const id = text(formData, "id");
  const checkOut = text(formData, "checkOut");
  if (!uuidPattern.test(businessId) || !uuidPattern.test(id) || !datePattern.test(checkOut)) {
    return { error: "Choose a new check-out date." };
  }
  const supabase = await getClient();
  const { error } = await supabase.rpc("change_checkout_date", {
    p_reservation_id: id,
    p_new_check_out: checkOut,
  });
  if (error) {
    return fail(error, "The stay could not be changed.");
  }
  return done(businessId, "Check-out date updated.");
}

export async function chargeOrderToRoom(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const id = text(formData, "id");
  const orderCode = text(formData, "orderCode");
  if (!uuidPattern.test(businessId) || !uuidPattern.test(id) || !/^[A-Za-z0-9-]{4,20}$/.test(orderCode)) {
    return { error: "Enter the order code, for example ORD-1A2B3C4D." };
  }
  const supabase = await getClient();
  const { data, error } = await supabase.rpc("charge_order_to_room", {
    p_reservation_id: id,
    p_order_code: orderCode,
  });
  if (error) {
    return fail(error, "The order could not be charged to the room.");
  }
  return done(businessId, `Order charged to the room bill (${Number(data).toLocaleString()}).`);
}

export async function reportMaintenance(
  _previous: HotelActionState,
  formData: FormData,
): Promise<HotelActionState> {
  const businessId = text(formData, "businessId");
  const roomId = text(formData, "roomId");
  const description = text(formData, "description");
  const priority = text(formData, "priority");
  if (
    !uuidPattern.test(businessId) ||
    !uuidPattern.test(roomId) ||
    description.length < 3 ||
    description.length > 500 ||
    !["low", "normal", "urgent"].includes(priority)
  ) {
    return { error: "Choose a room and describe the problem." };
  }
  const supabase = await getClient();
  const { error } = await supabase.rpc("report_maintenance", {
    p_room_id: roomId,
    p_description: description,
    p_priority: priority,
    p_block_room: text(formData, "blockRoom") === "on",
  });
  if (error) {
    return fail(error, "The issue could not be reported.");
  }
  return done(businessId, "Issue reported.");
}
