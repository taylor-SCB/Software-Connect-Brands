"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { addNote, logActivity, createDealForContact } from "../actions";
import { FormError } from "@/components/ui";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";
import {
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconPlus,
} from "@/components/icons";
import type { ActionState } from "@/lib/forms";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

// Clears the form once the action reports success, so the box is ready
// for the next entry instead of keeping stale text around.
function useResetOnSuccess(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) ref.current?.reset();
  }, [state]);
  return ref;
}

export function AddNoteForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addNote, {});
  const formRef = useResetOnSuccess(state);

  return (
    <form ref={formRef} action={formAction} className="space-y-2 p-5">
      <input type="hidden" name="contactId" value={contactId} />
      <textarea
        name="body"
        rows={3}
        placeholder="What should the team know about this account?"
        className="textarea"
      />
      <FormError message={state?.error} />
      <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
        {pending ? "Saving…" : "Add note"}
      </button>
    </form>
  );
}

export function LogActivityForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    logActivity,
    {},
  );
  const formRef = useResetOnSuccess(state);
  const [type, setType] = useState<ActivityTypeValue>("PHONE_CALL");

  return (
    <form ref={formRef} action={formAction} className="space-y-3 p-5">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="type" value={type} />

      <div className="flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((option) => {
          const Icon = ACTIVITY_ICONS[option];
          const selected = option === type;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              aria-pressed={selected}
              className={`btn btn-sm ${selected ? "btn-primary" : "btn-ghost"}`}
            >
              <Icon size={13} />
              {ACTIVITY_LABELS[option]}
            </button>
          );
        })}
      </div>

      <textarea
        name="body"
        rows={2}
        placeholder="Left a voicemail about the kitchen quote…"
        className="textarea"
      />
      <FormError message={state?.error} />
      <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
        {pending ? "Logging…" : `Log ${ACTIVITY_LABELS[type].toLowerCase()}`}
      </button>
    </form>
  );
}

export function AddDealForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createDealForContact,
    {},
  );
  const formRef = useResetOnSuccess(state);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 p-5">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="deal-title">
            Deal title
          </label>
          <input
            id="deal-title"
            name="title"
            required
            placeholder="Kitchen remodel"
            className="input input-sm"
          />
        </div>
        <div className="w-28">
          <label className="label" htmlFor="deal-value">
            Value ($)
          </label>
          <input
            id="deal-value"
            name="value"
            type="number"
            min="0"
            step="0.01"
            placeholder="2500"
            className="input input-sm num"
          />
        </div>
        <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
          <IconPlus size={13} />
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <FormError message={state?.error} />
    </form>
  );
}
