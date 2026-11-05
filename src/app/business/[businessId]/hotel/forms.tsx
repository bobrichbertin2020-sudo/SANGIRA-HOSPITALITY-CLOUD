"use client";

import { useActionState } from "react";
import {
  addFolioCharge,
  changeCheckoutDate,
  chargeOrderToRoom,
  checkOutGuest,
  createReservation,
  createRoom,
  recordFolioPayment,
  reportMaintenance,
  setHotelModule,
  type HotelActionState,
} from "./actions";

type ActionFn = (state: HotelActionState, formData: FormData) => Promise<HotelActionState>;

const initial: HotelActionState = {};
const inputClass = "form-input";
const buttonClass =
  "rounded-lg bg-[#153d32] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#205443] disabled:cursor-wait disabled:opacity-60";
const smallButton =
  "rounded-lg border border-[#d6ded8] px-3 py-1.5 text-xs font-semibold text-[#29483c] hover:bg-[#f7f8f6] disabled:opacity-60";

function Message({ state }: { state: HotelActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="mb-2 rounded-lg bg-[#fff1ee] px-3 py-2 text-xs text-[#9c392d]">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="mb-2 rounded-lg border border-[#d8e8db] bg-[#edf6ef] px-3 py-2 text-xs text-[#285c3e]">
        {state.success}
      </p>
    );
  }
  return null;
}

export function HotelModuleToggle({
  businessId,
  enabled,
}: {
  businessId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(setHotelModule, initial);
  return (
    <form action={action}>
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <input name="enabled" type="hidden" value={enabled ? "false" : "true"} />
      <button className={enabled ? smallButton : buttonClass} disabled={pending}>
        {enabled ? "Turn hotel module off" : "Turn on hotel module"}
      </button>
    </form>
  );
}

export function ActionButton({
  action,
  businessId,
  id,
  label,
  danger,
}: {
  action: ActionFn;
  businessId: string;
  id: string;
  label: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="inline-block">
      <input name="businessId" type="hidden" value={businessId} />
      <input name="id" type="hidden" value={id} />
      <button
        className={danger ? `${smallButton} text-[#9c392d]` : smallButton}
        disabled={pending}
      >
        {pending ? "..." : label}
      </button>
      {state.error && (
        <p role="alert" className="mt-1 max-w-xs text-xs text-[#9c392d]">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function AddRoomForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState(createRoom, initial);
  return (
    <form action={action} className="mt-4 space-y-3">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={inputClass} maxLength={20} name="roomNumber" placeholder="Room number" required />
        <input className={inputClass} maxLength={60} name="roomType" placeholder="Type (Single, Double...)" required />
        <input className={inputClass} defaultValue={2} max={20} min={1} name="capacity" placeholder="Guests" required type="number" />
        <input className={inputClass} min="0" name="rate" placeholder="Nightly rate" required step="0.01" type="number" />
      </div>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Adding..." : "Add room"}
      </button>
    </form>
  );
}

export function ReservationForm({
  businessId,
  rooms,
  today,
}: {
  businessId: string;
  rooms: { id: string; room_number: string; room_type: string; nightly_rate: number; capacity: number }[];
  today: string;
}) {
  const [state, action, pending] = useActionState(createReservation, initial);
  return (
    <form action={action} className="mt-4 space-y-3">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={inputClass} maxLength={120} name="guestName" placeholder="Guest name" required />
        <input className={inputClass} maxLength={40} name="guestPhone" placeholder="Phone" type="tel" />
      </div>
      <select className={inputClass} defaultValue="" name="roomId" required>
        <option disabled value="">Select a room</option>
        {rooms.map((room) => (
          <option key={room.id} value={room.id}>
            {room.room_number} · {room.room_type} · sleeps {room.capacity} · {Number(room.nightly_rate).toLocaleString()}/night
          </option>
        ))}
      </select>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-[#33463a]">
          Arrival
          <input className={inputClass} defaultValue={today} min={today} name="checkIn" required type="date" />
        </label>
        <label className="text-xs font-medium text-[#33463a]">
          Departure
          <input className={inputClass} min={today} name="checkOut" required type="date" />
        </label>
        <label className="text-xs font-medium text-[#33463a]">
          Guests
          <input className={inputClass} defaultValue={1} min={1} name="guests" required type="number" />
        </label>
      </div>
      <input className={inputClass} maxLength={500} name="notes" placeholder="Notes (optional)" />
      <button className={buttonClass} disabled={pending}>
        {pending ? "Saving..." : "Save reservation"}
      </button>
    </form>
  );
}

export function FolioForms({
  businessId,
  reservationId,
  balance,
  canWaive,
  checkOut,
}: {
  businessId: string;
  reservationId: string;
  balance: number;
  canWaive: boolean;
  checkOut: string;
}) {
  const [chargeState, chargeAction, chargePending] = useActionState(addFolioCharge, initial);
  const [payState, payAction, payPending] = useActionState(recordFolioPayment, initial);
  const [outState, outAction, outPending] = useActionState(checkOutGuest, initial);
  const [dateState, dateAction, datePending] = useActionState(changeCheckoutDate, initial);
  const [roomState, roomAction, roomPending] = useActionState(chargeOrderToRoom, initial);

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-[#f7f8f6] p-3">
      <Message state={chargeState} />
      <Message state={payState} />
      <Message state={outState} />
      <Message state={dateState} />
      <Message state={roomState} />
      <form action={roomAction} className="grid gap-2 sm:grid-cols-[2fr_auto]">
        <input name="businessId" type="hidden" value={businessId} />
        <input name="id" type="hidden" value={reservationId} />
        <input aria-label="Order code" className={inputClass} maxLength={20} name="orderCode" placeholder="Room service order code (ORD-...)" required />
        <button className={smallButton} disabled={roomPending}>Charge order to room</button>
      </form>
      <form action={dateAction} className="grid gap-2 sm:grid-cols-[2fr_auto]">
        <input name="businessId" type="hidden" value={businessId} />
        <input name="id" type="hidden" value={reservationId} />
        <input aria-label="New check-out date" className={inputClass} defaultValue={checkOut} name="checkOut" required type="date" />
        <button className={smallButton} disabled={datePending}>Change check-out date</button>
      </form>
      <form action={chargeAction} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <input name="businessId" type="hidden" value={businessId} />
        <input name="id" type="hidden" value={reservationId} />
        <input aria-label="Charge description" className={inputClass} maxLength={160} name="description" placeholder="Charge (minibar, laundry...)" required />
        <input aria-label="Charge amount" className={inputClass} min="0.01" name="amount" placeholder="Amount" required step="0.01" type="number" />
        <button className={smallButton} disabled={chargePending}>Add charge</button>
      </form>
      {balance > 0 && (
        <form action={payAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input name="businessId" type="hidden" value={businessId} />
          <input name="id" type="hidden" value={reservationId} />
          <input aria-label="Payment amount" className={inputClass} defaultValue={balance} max={balance} min="0.01" name="amount" required step="0.01" type="number" />
          <select aria-label="Payment method" className={inputClass} defaultValue="cash" name="method">
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile money</option>
            <option value="card">Card</option>
            <option value="bank">Bank transfer</option>
          </select>
          <input aria-label="Reference" className={inputClass} maxLength={120} name="reference" placeholder="Reference" />
          <button className={smallButton} disabled={payPending}>Record payment</button>
        </form>
      )}
      <form action={outAction} className="flex flex-wrap items-center gap-3">
        <input name="businessId" type="hidden" value={businessId} />
        <input name="id" type="hidden" value={reservationId} />
        {canWaive && balance > 0 && (
          <label className="flex items-center gap-2 text-xs text-[#64736a]">
            <input name="allowUnpaid" type="checkbox" /> Check out with unpaid balance (manager)
          </label>
        )}
        <button className={buttonClass} disabled={outPending}>
          {outPending ? "Checking out..." : "Check out"}
        </button>
      </form>
    </div>
  );
}

export function DepositForm({
  businessId,
  reservationId,
}: {
  businessId: string;
  reservationId: string;
}) {
  const [state, action, pending] = useActionState(recordFolioPayment, initial);
  return (
    <form action={action} className="mt-2 grid w-full gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <div className="sm:col-span-3">
        <Message state={state} />
      </div>
      <input name="businessId" type="hidden" value={businessId} />
      <input name="id" type="hidden" value={reservationId} />
      <input aria-label="Deposit amount" className={inputClass} min="0.01" name="amount" placeholder="Deposit amount" required step="0.01" type="number" />
      <select aria-label="Deposit method" className={inputClass} defaultValue="cash" name="method">
        <option value="cash">Cash</option>
        <option value="mobile_money">Mobile money</option>
        <option value="card">Card</option>
        <option value="bank">Bank transfer</option>
      </select>
      <button className={smallButton} disabled={pending}>Take deposit</button>
    </form>
  );
}

export function MaintenanceForm({
  businessId,
  rooms,
}: {
  businessId: string;
  rooms: { id: string; room_number: string }[];
}) {
  const [state, action, pending] = useActionState(reportMaintenance, initial);
  return (
    <form action={action} className="mt-4 space-y-3">
      <Message state={state} />
      <input name="businessId" type="hidden" value={businessId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <select aria-label="Room" className={inputClass} defaultValue="" name="roomId" required>
          <option disabled value="">Room</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>{room.room_number}</option>
          ))}
        </select>
        <select aria-label="Priority" className={inputClass} defaultValue="normal" name="priority">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <input className={inputClass} maxLength={500} minLength={3} name="description" placeholder="What is wrong?" required />
      <label className="flex items-center gap-2 text-xs text-[#64736a]">
        <input name="blockRoom" type="checkbox" /> Take the room out of service until fixed
      </label>
      <button className={buttonClass} disabled={pending}>
        {pending ? "Reporting..." : "Report issue"}
      </button>
    </form>
  );
}
