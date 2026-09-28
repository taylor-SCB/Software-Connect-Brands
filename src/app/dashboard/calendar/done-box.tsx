"use client";

import { useState, useTransition } from "react";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";
import { FormError } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { completeEventWithLog, setEventDone } from "./actions";

// The activity type an entry reads back as when it is ticked: a Call is
// a call, a Meeting a meeting; a quote follow-up was most likely a call,
// and the chips let the person say otherwise. Mirrors activityTypeFor in
// calendar-auto.ts, kept here so the box needs no server round trip.
function guessType(eventType: string): ActivityTypeValue {
  const lower = eventType.toLowerCase();
  if (lower === "meeting") return "MEETING";
  if (lower === "email") return "EMAIL";
  if (lower === "text") return "TEXT";
  return "PHONE_CALL";
}

// Whether ticking this entry can write a line in somebody's history: it
// is with a contact or a company, is not done yet, and was not logged
// already (a call logged from the form arrives with its line attached).
export function canLogOnDone(event: {
  contactId: string | null;
  companyId: string | null;
  doneAt: string | null;
  activityId?: string | null;
}) {
  return Boolean(event.contactId || event.companyId) && !event.doneAt && !event.activityId;
}

// "How did it go?" — ticking a scheduled call done and logging it in one
// step. "Just tick it" keeps the old behaviour for a day that needs no
// line in anyone's history.
export function DoneBox({
  event,
  onClose,
}: {
  event: { id: string; type: string; title: string; notes: string };
  onClose: () => void;
}) {
  const [type, setType] = useState<ActivityTypeValue>(guessType(event.type));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
      else onClose();
    });

  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3" data-testid="done-box">
      <p className="text-xs font-medium">How did it go?</p>
      <div className="flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            aria-pressed={option === type}
            className={`btn btn-sm ${option === type ? "btn-primary" : "btn-ghost"}`}
            data-testid={`done-type-${option}`}
          >
            {ACTIVITY_LABELS[option]}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(fired) => setNote(fired.target.value)}
        rows={2}
        placeholder={event.notes ? `Leave blank to log “${event.notes.slice(0, 60)}”` : "Spoke to Dana, she wants the revised quote by Friday…"}
        aria-label="How did it go"
        className="textarea"
        data-testid="done-note"
      />
      <FormError message={error} />
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => completeEventWithLog(event.id, { activityType: type, note }))}
          className="btn btn-primary btn-sm"
          data-testid="done-log"
        >
          <IconCheck size={12} />
          {pending ? "Logging…" : `Log ${ACTIVITY_LABELS[type].toLowerCase()} and tick it`}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setEventDone(event.id, true))}
          className="btn btn-ghost btn-sm"
          data-testid="done-only"
        >
          Just tick it
        </button>
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
