"use client";

import { useActionState, useState } from "react";
import {
  createStaffInvitation,
  type StaffInviteState,
} from "@/app/business/[businessId]/staff/actions";

type InviteFormProps = {
  businessId: string;
  departments: Array<{ id: string; name: string }>;
  roles: Array<{ role_key: string; label: string }>;
};

const initialState: StaffInviteState = {};

export function InviteForm({ businessId, departments, roles }: InviteFormProps) {
  const [state, formAction, pending] = useActionState(
    createStaffInvitation,
    initialState,
  );
  const [copied, setCopied] = useState(false);

  async function copyInvitation() {
    if (!state.invitationPath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${state.invitationPath}`,
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      {state.error && (
        <p
          role="alert"
          className="mb-5 rounded-lg bg-[#fff1ee] px-4 py-3 text-sm text-[#9c392d]"
        >
          {state.error}
        </p>
      )}
      {state.invitationPath && (
        <div className="mb-6 rounded-xl border border-[#d8e8db] bg-[#edf6ef] p-4">
          <p className="text-sm font-semibold text-[#285c3e]">
            Invitation created. Share this one-time link with the employee.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="max-w-full break-all rounded bg-white px-2 py-1 text-xs text-[#33463a]">
              {state.invitationPath}
            </code>
            <button
              className="rounded-lg border border-[#b8d2c3] px-3 py-2 text-sm font-semibold text-[#285c3e] hover:bg-white"
              onClick={copyInvitation}
              type="button"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#53635a]">
            The recipient must sign in with this email address and verify it.
            This link expires in seven days and can only be used once.
          </p>
        </div>
      )}
      <form action={formAction} className="space-y-5">
        <input name="businessId" type="hidden" value={businessId} />
        <label className="block text-sm font-medium text-[#33463a]">
          Employee email
          <input
            autoComplete="email"
            className="form-input"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-[#33463a]">Roles</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {roles.map((role) => (
              <label
                className="flex items-center gap-2 rounded-lg border border-[#edf0ed] px-3 py-2.5 text-sm"
                key={role.role_key}
              >
                <input
                  className="accent-[#153d32]"
                  name="roleKeys"
                  type="checkbox"
                  value={role.role_key}
                />
                {role.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium text-[#33463a]">Departments</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {departments.map((department) => (
              <label
                className="flex items-center gap-2 rounded-lg border border-[#edf0ed] px-3 py-2.5 text-sm"
                key={department.id}
              >
                <input
                  className="accent-[#153d32]"
                  name="departmentIds"
                  type="checkbox"
                  value={department.id}
                />
                {department.name}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="rounded-lg bg-[#153d32] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#205443] disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "Creating invitation..." : "Create invitation link"}
        </button>
      </form>
    </div>
  );
}
