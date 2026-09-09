"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { addNote, logActivity, createDealForContact } from "../actions";
import { FormError } from "@/components/ui";
import { ContactMultiSelect, type PickableContact } from "@/components/contact-multi-select";
import {
  ACTIVITY_LABELS,
  ACTIVITY_TYPES,
  NOTE_LABELS,
  NOTE_LABEL_NAMES,
  NOTE_LABEL_COLORS,
  type ActivityTypeValue,
  type NoteLabelValue,
} from "@/lib/constants";
import {
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconPlus,
  IconTag,
} from "@/components/icons";
import type { ActionState } from "@/lib/forms";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

// Who an entry is for: the contact page passes contactId, the company
// page passes companyId. Only a contact entry can fan out to others.
export type LogTargetProps =
  | { contactId: string; companyId?: undefined }
  | { companyId: string; contactId?: undefined };

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

// Clears the form once the action reports success, so the box is ready
// for the next entry instead of keeping stale text around. The counter
// re-keys any client-side state (label chips, extra contacts) too.
function useResettingAction(action: FormAction) {
  const ref = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      if (result?.success) setResetKey((key) => key + 1);
      return result;
    },
    {},
  );
  useEffect(() => {
    if (state?.success) ref.current?.reset();
  }, [state]);
  return { ref, resetKey, state, formAction, pending };
}

function TargetFields({ target }: { target: LogTargetProps }) {
  return target.contactId ? (
    <input type="hidden" name="contactId" value={target.contactId} />
  ) : (
    <input type="hidden" name="companyId" value={target.companyId} />
  );
}

export function AddNoteForm({
  target,
  contacts,
}: {
  target: LogTargetProps;
  contacts?: PickableContact[];
}) {
  const { ref, resetKey, state, formAction, pending } = useResettingAction(addNote);

  return (
    <form ref={ref} action={formAction} className="space-y-3 p-5">
      <TargetFields target={target} />
      <textarea
        name="body"
        rows={3}
        placeholder={
          target.contactId
            ? "What should the team know about this person?"
            : "What should the team know about this company?"
        }
        className="textarea"
      />
      <NoteLabelChips key={`label-${resetKey}`} />
      <FormError message={state?.error} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
          {pending ? "Saving…" : "Add note"}
        </button>
        {target.contactId && contacts && (
          <ContactMultiSelect
            key={`multi-${resetKey}`}
            contacts={contacts}
            currentId={target.contactId}
          />
        )}
      </div>
    </form>
  );
}

// One optional label per note. Tap again to clear it.
function NoteLabelChips() {
  const [label, setLabel] = useState<NoteLabelValue | "">("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="label" value={label} />
      <IconTag size={12} className="text-[var(--text-faint)]" />
      {NOTE_LABELS.map((option) => {
        const on = option === label;
        const color = NOTE_LABEL_COLORS[option];
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => setLabel(on ? "" : option)}
            className="badge transition-colors"
            style={{
              color: on ? color : "var(--text-dim)",
              background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
              borderColor: on
                ? `color-mix(in srgb, ${color} 45%, transparent)`
                : "var(--border)",
            }}
          >
            {NOTE_LABEL_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}

export function LogActivityForm({
  target,
  contacts,
}: {
  target: LogTargetProps;
  contacts?: PickableContact[];
}) {
  const { ref, resetKey, state, formAction, pending } = useResettingAction(logActivity);
  const [type, setType] = useState<ActivityTypeValue>("PHONE_CALL");

  return (
    <form ref={ref} action={formAction} className="space-y-3 p-5">
      <TargetFields target={target} />
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
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
          {pending ? "Logging…" : `Log ${ACTIVITY_LABELS[type].toLowerCase()}`}
        </button>
        {target.contactId && contacts && (
          <ContactMultiSelect
            key={`multi-${resetKey}`}
            contacts={contacts}
            currentId={target.contactId}
          />
        )}
      </div>
    </form>
  );
}

export function AddDealForm({ contactId }: { contactId: string }) {
  const { ref, state, formAction, pending } = useResettingAction(createDealForContact);

  return (
    <form ref={ref} action={formAction} className="space-y-3 p-5">
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
            Est. value ($)
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
