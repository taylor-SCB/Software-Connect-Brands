"use client";

import { ink } from "@/lib/ink";
import { useActionState, useRef, useEffect, useState } from "react";
import { addNote, createDealForContact } from "../actions";
import { FormError } from "@/components/ui";
import { ContactMultiSelect, type PickableContact } from "@/components/contact-multi-select";
import type { CompanyPerson } from "@/components/company-people-picker";
import { HowDidItGo, TYPE_ORDER } from "@/components/how-did-it-go/how-did-it-go";
import { useDialReturn } from "@/components/how-did-it-go/dial-return";
import {
  ACTIVITY_LABELS,
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
// page passes companyId. A contact entry fans out to other contacts; a
// company activity can be put on the company's own people instead.
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
  // Counts every result, success or refusal, so a field keyed on it is
  // redrawn with the values the refusal handed back (`kept`).
  const [attempt, setAttempt] = useState(0);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      if (result?.success) setResetKey((key) => key + 1);
      setAttempt((n) => n + 1);
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
              color: on ? ink(color) : "var(--text-dim)",
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

// "Log activity" is the "What happened with Kristen?" bar (BDR redesign,
// Nov 11, 2026): one tap opens the How did it go? sheet, set to Call, or
// to the kind of touch tapped beside it. The sheet holds everything the
// old inline form had — the note, When and Time behind "Just now ▾", "+
// others", the company's people — with the outcome chips first. Coming
// back to the page from a tel: or sms: tap opens it on its own.
export function LogActivityForm({
  target,
  current,
  companyPeople,
  userName,
  today,
  name,
}: {
  target: LogTargetProps;
  // The contact whose page this is, for "+ others".
  current?: PickableContact;
  // On a company page: its first people, offered as ticks.
  companyPeople?: CompanyPerson[];
  // On a company page: who is logging, for the Front desk line.
  userName?: string;
  // Today in the workspace's zone, for the "When" field's default. Comes
  // from the server so the form never guesses from the browser's clock.
  today: string;
  // Who the bar names ("What happened with Kristen?"); the contact's name
  // by default, the company's when given on a company page.
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityTypeValue>("PHONE_CALL");
  const [picks, setPicks] = useState<string[]>([]);
  const who = name ?? current?.name ?? "";
  const first = target.companyId ? who : who.split(/\s+/)[0];

  useDialReturn(
    { contactIds: target.contactId ? [target.contactId] : [], companyId: target.companyId ?? null, page: true },
    (tap) => {
      setType(tap.type);
      setPicks(target.companyId && tap.contactId ? [tap.contactId] : []);
      setOpen(true);
    },
  );

  const openAs = (next: ActivityTypeValue) => {
    setType(next);
    setPicks([]);
    setOpen(true);
  };

  return (
    <div className="space-y-2 p-5" data-testid="log-bar-wrap">
      <button
        type="button"
        onClick={() => openAs("PHONE_CALL")}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-sm font-medium transition-colors hover:border-[var(--border-strong)]"
        aria-haspopup="dialog"
        data-testid="log-bar"
      >
        <span className="min-w-0 truncate">{first ? `What happened with ${first}?` : "What happened?"}</span>
        <span aria-hidden className="faint shrink-0">▸</span>
      </button>
      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Log a touch">
        {TYPE_ORDER.map((option) => {
          const Icon = ACTIVITY_ICONS[option];
          return (
            <button
              key={option}
              type="button"
              onClick={() => openAs(option)}
              className="btn btn-ghost btn-sm min-h-11 sm:min-h-0"
              aria-label={`Log ${ACTIVITY_LABELS[option].toLowerCase()}`}
              data-testid={`log-bar-${option}`}
            >
              <Icon size={13} />
              {BAR_WORDS[option]}
            </button>
          );
        })}
      </div>
      <HowDidItGo
        open={open}
        onClose={() => setOpen(false)}
        target={target}
        type={type}
        name={who || undefined}
        today={today}
        current={current}
        companyPeople={companyPeople}
        userName={userName}
        pickContactIds={picks}
      />
    </div>
  );
}

const BAR_WORDS: Record<ActivityTypeValue, string> = { PHONE_CALL: "Call", TEXT: "Text", EMAIL: "Email", MEETING: "Meeting" };

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
