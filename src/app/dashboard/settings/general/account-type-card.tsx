"use client";

import { useActionState, useState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_BLURBS,
  ACCOUNT_TYPE_LABELS,
  isSupplierAccountType,
  type AccountTypeValue,
} from "@/lib/account-types";
import type { ActionState } from "@/lib/forms";
import { cancelAccountTypeRequest, requestAccountTypeChange } from "./actions";

export type OpenTypeRequest = { toType: AccountTypeValue; askedOn: string; askedBy: string | null };
export type AnsweredTypeRequest = { toType: AccountTypeValue; approved: boolean; answeredOn: string };

// The account type on Settings → General: what this workspace is, and the
// way to ask for a change, which the operator approves.
export function AccountTypeCard({
  accountType,
  hasPlace,
  canEdit,
  open,
  answered,
}: {
  accountType: AccountTypeValue;
  // A city or state is on file, to show beside the name in pickers.
  hasPlace: boolean;
  canEdit: boolean;
  open: OpenTypeRequest | null;
  answered: AnsweredTypeRequest | null;
}) {
  const [asking, setAsking] = useState(false);
  const [requestState, requestAction, requesting] = useActionState<ActionState, FormData>(
    requestAccountTypeChange,
    {},
  );
  const [cancelState, cancelAction, cancelling] = useActionState<ActionState, FormData>(
    cancelAccountTypeRequest,
    {},
  );
  // The newest answer from either form is the one shown under the card;
  // a request that went in also closes its form, the render it lands.
  const [notice, setNotice] = useState<ActionState>({});
  const [seenRequest, setSeenRequest] = useState(requestState);
  if (requestState !== seenRequest) {
    setSeenRequest(requestState);
    if (requestState.success) setAsking(false);
    setNotice(requestState.success ? requestState : {});
  }
  const [seenCancel, setSeenCancel] = useState(cancelState);
  if (cancelState !== seenCancel) {
    setSeenCancel(cancelState);
    setNotice(cancelState);
  }
  const kept = requestState.kept ?? {};
  const choices = ACCOUNT_TYPES.filter((type) => type !== accountType);

  return (
    <div className="space-y-3 p-5" data-testid="account-type-card">
      <div>
        <p className="text-base font-semibold" data-testid="account-type-current">
          {ACCOUNT_TYPE_LABELS[accountType]}
        </p>
        <p className="muted text-sm">{ACCOUNT_TYPE_BLURBS[accountType]}</p>
        <p className="faint mt-1 text-xs">
          {isSupplierAccountType(accountType)
            ? `Businesses on Software Connect Brands can pick you as a supplier. They see your name, city and state${hasPlace ? "." : " — add your city and state below so they can tell you apart."}`
            : "You're not listed as a supplier for other businesses to pick."}
        </p>
      </div>

      {open ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
          data-testid="account-type-waiting"
        >
          <p className="text-sm">
            Waiting on approval: {ACCOUNT_TYPE_LABELS[accountType]} → {ACCOUNT_TYPE_LABELS[open.toType]}, asked{" "}
            {open.askedOn}
            {open.askedBy ? ` by ${open.askedBy}` : ""}.
          </p>
          {canEdit && (
            <form action={cancelAction}>
              <button type="submit" disabled={cancelling} className="btn btn-ghost btn-sm">
                {cancelling ? "Cancelling…" : "Cancel request"}
              </button>
            </form>
          )}
        </div>
      ) : (
        answered && (
          <p className="faint text-xs" data-testid="account-type-answered">
            Your change to {ACCOUNT_TYPE_LABELS[answered.toType]} was {answered.approved ? "approved" : "declined"} on{" "}
            {answered.answeredOn}.
          </p>
        )
      )}

      {!canEdit ? (
        <p className="faint text-xs">Ask an owner or admin to request a change.</p>
      ) : (
        !open &&
        (asking ? (
          <form action={requestAction} className="space-y-3" data-testid="account-type-request-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="account-type-to">
                  Change to
                </label>
                <select
                  id="account-type-to"
                  name="toType"
                  key={kept.toType ?? choices[0]}
                  defaultValue={kept.toType ?? choices[0]}
                  className="select"
                >
                  {choices.map((type) => (
                    <option key={type} value={type}>
                      {ACCOUNT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="account-type-note">
                  Note · optional
                </label>
                <input
                  id="account-type-note"
                  name="note"
                  maxLength={500}
                  defaultValue={kept.note}
                  placeholder="We distribute for 40 manufacturers"
                  className="input"
                />
              </div>
            </div>
            <FormError message={requestState.error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(false)} className="btn btn-ghost btn-sm">
                Close
              </button>
              <button type="submit" disabled={requesting} className="btn btn-primary btn-sm">
                {requesting ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAsking(true)} className="btn btn-ghost btn-sm">
            Request a change
          </button>
        ))
      )}

      <FormSuccess message={notice.success} />
      <FormError message={notice.error} />
    </div>
  );
}
