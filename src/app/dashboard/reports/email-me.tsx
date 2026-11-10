"use client";

import { startTransition, useActionState, useState } from "react";
import { subscribeReport, unsubscribeReport } from "./actions";
import type { ActionState } from "@/lib/forms";

// "Email me this": the report, on a cadence, to yourself — or, for an Owner
// or Admin, to any teammate — about the rep the picker is on (or the whole
// team). Emails go out at 6am in the workspace's time zone.

export function EmailMe({
  report,
  reportLabel,
  cadences,
  meId,
  isAdmin,
  teammates,
  repId,
  repName,
  subscriptions,
  emailOn,
}: {
  report: string;
  reportLabel: string;
  cadences: { value: string; label: string }[];
  meId: string;
  isAdmin: boolean;
  teammates: { id: string; name: string }[];
  repId: string;
  repName: string;
  subscriptions: { id: string; recipient: string; cadence: string; about: string }[];
  emailOn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState<ActionState, FormData>(subscribeReport, {});

  return (
    <div className="relative" data-testid="email-me">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="email-me-open">
        Email me this
      </button>
      {open && (
        <div
          className="card popover absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] p-4 text-sm shadow-2xl"
          role="dialog"
          aria-label={`Email ${reportLabel}`}
        >
          {/* Sent in a transition rather than as the form's action, so React
              doesn't reset the picks after a save (a second press would
              otherwise send the first option). */}
          <form
            action={action}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(() => action(data));
            }}
            className="space-y-3"
          >
            <input type="hidden" name="report" value={report} />
            <input type="hidden" name="repId" value={repId} />
            <p className="font-medium">
              Email {reportLabel} · {repName}
            </p>
            <label className="block">
              <span className="label">How often</span>
              <select name="cadence" className="select input-sm" defaultValue={cadences[0]?.value} data-testid="email-me-cadence">
                {cadences.map((cadence) => (
                  <option key={cadence.value} value={cadence.value}>
                    {cadence.label}
                  </option>
                ))}
              </select>
            </label>
            {isAdmin && (
              <label className="block">
                <span className="label">To</span>
                <select name="recipientId" className="select input-sm" defaultValue={meId} data-testid="email-me-recipient">
                  {teammates.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.id === meId ? `Me (${person.name})` : person.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="faint text-xs">Sent at 6am your time, covering the period just finished.{emailOn ? "" : " Email isn't switched on for this site yet, so nothing will go out until it is."}</p>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving} data-testid="email-me-save">
                {saving ? "Saving…" : "Email it"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {state.error && <p className="text-xs text-[var(--danger)]">{state.error}</p>}
            {state.success && (
              <p className="text-xs text-[var(--ok)]" data-testid="email-me-done">
                {state.success}
              </p>
            )}
          </form>
          {subscriptions.length > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <p className="label">Already going out</p>
              <ul className="space-y-1.5" data-testid="email-me-list">
                {subscriptions.map((sub) => (
                  <li key={sub.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      {sub.recipient} · {sub.cadence} · {sub.about}
                    </span>
                    <form action={unsubscribeReport}>
                      <input type="hidden" name="id" value={sub.id} />
                      <button type="submit" className="link text-xs" data-testid="email-me-remove">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
