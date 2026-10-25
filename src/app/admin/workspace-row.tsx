"use client";

import { useActionState, useState } from "react";
import { StatusBadge } from "@/components/ui";
import { IconMail, IconPhone, IconSend, IconTrash } from "@/components/icons";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountTypeValue } from "@/lib/account-types";
import type { ActionState } from "@/lib/forms";
import { setOrganizationStatus, deleteOrganization, resendOwnerInvite, setOrganizationType } from "./actions";

type Person = {
  name: string;
  email: string;
  phone: string | null;
  role: string;
  lastLoginAt: string | null;
  isSuperAdmin: boolean;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  status: string;
  accountType: AccountTypeValue;
  // The operator who made it from Create Account; null for a signup.
  createdByName: string | null;
  createdAt: string;
  reviewedAt: string | null;
  users: Person[];
  _count: { users: number; contacts: number; quotes: number; contracts: number };
};

function StatusButton({
  organizationId,
  status,
  children,
  variant = "ghost",
}: {
  organizationId: string;
  status: "ACTIVE" | "PAUSED" | "REJECTED";
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  return (
    <form action={setOrganizationStatus}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`btn btn-${variant} btn-sm`}>
        {children}
      </button>
    </form>
  );
}

// The operator's direct change of a workspace's type. Saves as soon as a
// type is picked, like the role select on Company Users; keyed on the
// saved type so a revalidated row shows what is stored.
function TypeSelect({ organizationId, accountType }: { organizationId: string; accountType: AccountTypeValue }) {
  return (
    <form action={setOrganizationType} className="flex items-center gap-1.5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label className="faint text-xs" htmlFor={`type-${organizationId}`}>
        Type
      </label>
      <select
        id={`type-${organizationId}`}
        key={accountType}
        name="accountType"
        defaultValue={accountType}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label="Account type"
        className="select input-sm py-1 pr-7 text-xs"
        data-testid="workspace-type"
      >
        {ACCOUNT_TYPES.map((type) => (
          <option key={type} value={type}>
            {ACCOUNT_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
    </form>
  );
}

function ResendOwnerInvite({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(resendOwnerInvite, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
        <IconSend size={12} />
        {pending ? "Sending…" : "Resend invite"}
      </button>
      {state.error && (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {state.error}
        </span>
      )}
      {state.success && (
        <span role="status" className="text-xs text-[var(--ok)]">
          {state.success}
        </span>
      )}
    </form>
  );
}

export function WorkspaceRow({ organization }: { organization: AdminWorkspace }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typedName, setTypedName] = useState("");

  const owner = organization.users.find((user) => user.role === "OWNER") ?? organization.users[0];
  // The most recent login by anyone in the workspace — the honest answer to
  // "is this account alive", which the owner's own last login can miss.
  const lastSeen = organization.users
    .map((user) => user.lastLoginAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{organization.name}</h3>
            <StatusBadge status={organization.status} />
            <span className="faint text-xs" data-testid="workspace-type-label">
              {ACCOUNT_TYPE_LABELS[organization.accountType]}
            </span>
          </div>

          {owner && (
            <div className="muted mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span>{owner.name}</span>
              <a href={`mailto:${owner.email}`} className="link inline-flex items-center gap-1">
                <IconMail size={11} />
                {owner.email}
              </a>
              {owner.phone && (
                <a href={`tel:${owner.phone}`} className="link inline-flex items-center gap-1">
                  <IconPhone size={11} />
                  {owner.phone}
                </a>
              )}
            </div>
          )}

          <div className="faint mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              {organization.createdByName
                ? `Created by ${organization.createdByName} on ${organization.createdAt}`
                : `Signed up ${organization.createdAt}`}
            </span>
            {organization.reviewedAt && <span>Reviewed {organization.reviewedAt}</span>}
            <span>{lastSeen ? `Last login ${lastSeen}` : "Never logged in"}</span>
          </div>

          {organization.createdByName && owner && !owner.lastLoginAt && (
            <div className="mt-2">
              <ResendOwnerInvite organizationId={organization.id} />
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="num">{organization._count.users} people</span>
            <span className="num">{organization._count.contacts} contacts</span>
            <span className="num">{organization._count.quotes} quotes</span>
            <span className="num">{organization._count.contracts} contracts</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TypeSelect organizationId={organization.id} accountType={organization.accountType} />
          {organization.status === "PENDING" && (
            <>
              <StatusButton organizationId={organization.id} status="ACTIVE" variant="primary">
                Approve
              </StatusButton>
              <StatusButton organizationId={organization.id} status="REJECTED">
                Reject
              </StatusButton>
            </>
          )}
          {organization.status === "ACTIVE" && (
            <StatusButton organizationId={organization.id} status="PAUSED">
              Pause
            </StatusButton>
          )}
          {(organization.status === "PAUSED" || organization.status === "REJECTED") && (
            <StatusButton organizationId={organization.id} status="ACTIVE" variant="primary">
              {organization.status === "PAUSED" ? "Unpause" : "Approve"}
            </StatusButton>
          )}
          <button
            type="button"
            onClick={() => setConfirmingDelete((open) => !open)}
            className="btn btn-ghost btn-sm"
            aria-expanded={confirmingDelete}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <form
          action={deleteOrganization}
          className="mt-4 rounded-xl border border-[rgb(251_113_133/0.3)] bg-[rgb(251_113_133/0.06)] p-4"
        >
          <input type="hidden" name="organizationId" value={organization.id} />
          <p className="text-xs font-medium">
            Delete {organization.name} and everything in it?
          </p>
          <p className="faint mt-1 text-xs">
            {organization._count.contacts} contacts, {organization._count.quotes} quotes
            and {organization._count.contracts} contracts are deleted with it. This
            can&apos;t be undone — pause the workspace instead if you only want to
            lock them out.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              name="confirmName"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={`Type "${organization.name}" to confirm`}
              aria-label="Type the workspace name to confirm deletion"
              className="input max-w-xs text-xs"
            />
            <button
              type="submit"
              disabled={typedName.trim() !== organization.name}
              className="btn btn-danger btn-sm"
            >
              Delete permanently
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                setTypedName("");
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
