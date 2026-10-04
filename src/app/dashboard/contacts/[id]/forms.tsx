"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { addNote, logActivity, createDealForContact } from "../actions";
import { FormError, FormSuccess } from "@/components/ui";
import { ContactMultiSelect, type PickableContact } from "@/components/contact-multi-select";
import { CompanyPeoplePicker, type CompanyPerson } from "@/components/company-people-picker";
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
import type { FollowUpSeed, LogActivityState } from "@/lib/logging";
import { FollowUpPrompt } from "@/components/follow-up-prompt";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

// Who an entry is for: the contact page passes contactId, the company
// page passes companyId. A contact entry fans out to other contacts; a
// company activity can be put on the company's own people instead.
export type LogTargetProps =
  | { contactId: string; companyId?: undefined }
  | { companyId: string; contactId?: undefined };

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

// Clears the form once the action reports success, so the box is ready
// for the next entry instead of keeping stale text around. The counter
// re-keys any client-side state (label chips, extra contacts) too.
// `onResult` sees every result as it lands, for a form that opens
// something else off the back of a save.
function useResettingAction(action: FormAction, onResult?: (result: ActionState) => void) {
  const ref = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);
  // Counts every result, success or refusal, so a field keyed on it is
  // redrawn with the values the refusal handed back (`kept`).
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      if (result?.success) setResetKey((key) => key + 1);
      setAttempt((n) => n + 1);
      onResult?.(result);
      return result;
    },
    {},
  );
  useEffect(() => {
    if (state?.success) ref.current?.reset();
  }, [state]);
  return { ref, resetKey, attempt, state, formAction, pending };
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
  current,
}: {
  target: LogTargetProps;
  // The contact whose page this is, for "+ Include multiple contacts".
  current?: PickableContact;
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
        {target.contactId && current && (
          <ContactMultiSelect key={`multi-${resetKey}`} current={current} />
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
  current,
  companyPeople,
  userName,
  today,
}: {
  target: LogTargetProps;
  // The contact whose page this is, for "+ Include multiple contacts".
  current?: PickableContact;
  // On a company page: its first people, offered as ticks.
  companyPeople?: CompanyPerson[];
  // On a company page: who is logging, for the bypass line.
  userName?: string;
  // Today in the workspace's zone, for the "When" field's default. Comes
  // from the server so the form never guesses from the browser's clock.
  today: string;
}) {
  // The "Want to set a follow-up?" box opens under the form for the touch
  // just logged, and the line it leaves behind when it closes. Set from
  // each result as it lands, not by comparing messages: two calls in a
  // row report the same words and the second must open the box again.
  const [followUp, setFollowUp] = useState<FollowUpSeed | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const { ref, resetKey, attempt, state, formAction, pending } = useResettingAction(logActivity, (result: LogActivityState) => {
    if (result?.followUp) {
      setFollowUp(result.followUp);
      setNotice(undefined);
    }
  });
  const [type, setType] = useState<ActivityTypeValue>("PHONE_CALL");
  const [when, setWhen] = useState(today);
  const ahead = when > today;

  return (
    <div>
      <form ref={ref} action={formAction} className="space-y-3 p-5" data-testid="log-activity-form">
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

        {/* Keyed on the attempt so a refusal redraws it with what was
            typed (React empties a form whose action refuses). */}
        <textarea
          key={`body-${attempt}-${resetKey}`}
          name="body"
          rows={2}
          defaultValue={state?.kept?.body}
          placeholder="Left a voicemail about the kitchen quote…"
          className="textarea"
        />

        {target.companyId && companyPeople && (
          <CompanyPeoplePicker key={`people-${resetKey}`} companyId={target.companyId} people={companyPeople} userName={userName} />
        )}

        {/* When it happened — or when it will. Either way it lands on the
            calendar; only a day that has been is written to the history. */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs">
            <span className="faint block">When</span>
            <input
              key={`when-${resetKey}`}
              type="date"
              name="occurredOn"
              value={when}
              onChange={(event) => setWhen(event.target.value || today)}
              className="input input-sm"
              data-testid="activity-when"
            />
          </label>
          <label className="block text-xs">
            <span className="faint block">Time · optional</span>
            <input
              key={`at-${attempt}-${resetKey}`}
              type="time"
              name="atTime"
              defaultValue={state?.kept?.atTime}
              className="input input-sm"
              data-testid="activity-time"
            />
          </label>
          <p className="faint pb-1.5 text-xs" data-testid="activity-when-note">
            {ahead
              ? "That's ahead: it goes on the calendar as something to do, not into the history yet."
              : "Goes on the calendar on that day, too."}
          </p>
        </div>

        <FormError message={state?.error} />
        {/* A scheduled call leaves nothing behind on this page, so the one
            line saying where it went is the only sign it worked. */}
        {state?.success?.startsWith("Scheduled") && <FormSuccess message={state.success} />}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className="btn btn-ghost btn-sm" data-testid="activity-submit">
            {pending ? (ahead ? "Scheduling…" : "Logging…") : `${ahead ? "Schedule" : "Log"} ${ACTIVITY_LABELS[type].toLowerCase()}`}
          </button>
          {target.contactId && current && (
            <ContactMultiSelect key={`multi-${resetKey}`} current={current} />
          )}
        </div>
      </form>

      {/* Outside the form on purpose: Enter in one of its date boxes must
          not log a second call. */}
      {followUp && (
        <div className="px-5 pb-5">
          <FollowUpPrompt
            key={`follow-${resetKey}`}
            seed={followUp}
            today={today}
            onClose={(message) => {
              setFollowUp(null);
              setNotice(message);
            }}
          />
        </div>
      )}
      {notice && !followUp && (
        <div className="px-5 pb-5" data-testid="follow-up-notice">
          <FormSuccess message={notice} />
        </div>
      )}
    </div>
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
