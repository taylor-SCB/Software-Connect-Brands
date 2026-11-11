"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateActivity, type ActivityEditValues } from "@/app/dashboard/contacts/actions";
import {
  ACTIVITY_OUTCOME_LABELS,
  OUTCOMES_BY_TYPE,
  type ActivityOutcomeValue,
  type ActivityTypeValue,
} from "@/lib/constants";
import { UNDO_MS } from "@/components/how-did-it-go/undo-toast";

// Edit on a history line you logged (round 2, Nov 11, 2026). Opens under
// the line: what happened, how it went (the outcomes that fit the kind of
// touch, or "Not recorded") and when. Save writes it through updateActivity
// (every copy of a line logged on several people, and its calendar copy);
// "Saved · Undo" then stays on the line for ten seconds and Undo puts the
// old words, outcome and time back through the same action. It is not the
// page's toast: an edit isn't a new save, and the page's Undo (undoLog)
// would take the whole line away.
//
// A line whose day changed moves to another day's group and is drawn
// afresh, so the "Saved · Undo" it owes is kept here by line, for its ten
// seconds, and picked up again by the new copy.
type SavedEdit = { words: string; previous: ActivityEditValues; at: number };
const recent = new Map<string, SavedEdit>();
function stillSaved(activityId: string): SavedEdit | null {
  const saved = recent.get(activityId);
  if (!saved || Date.now() - saved.at >= UNDO_MS) return null;
  return saved;
}

export function ActivityEdit({
  activityId,
  type,
  body,
  outcome,
  on,
  time,
  today,
}: {
  activityId: string;
  type: string;
  body: string;
  outcome: string | null;
  // The day and "HH:MM" it happened, on the workspace's clock.
  on: string;
  time: string | null;
  today: string;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ActivityEditValues>({ activityId, body, outcome: outcome ?? "", on, time: time ?? "" });
  const [error, setError] = useState<string | undefined>();
  const [saved, setSavedState] = useState<SavedEdit | null>(() => stillSaved(activityId));
  const setSaved = (next: SavedEdit | null) => {
    if (next) recent.set(activityId, next);
    else recent.delete(activityId);
    setSavedState(next);
  };
  const [undone, setUndone] = useState(false);
  const [pending, start] = useTransition();
  const outcomes = OUTCOMES_BY_TYPE[type as ActivityTypeValue] ?? [];

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => {
      recent.delete(activityId);
      setSavedState(null);
    }, Math.max(0, UNDO_MS - (Date.now() - saved.at)));
    return () => window.clearTimeout(timer);
  }, [saved, activityId]);

  function begin() {
    setValues({ activityId, body, outcome: outcome ?? "", on, time: time ?? "" });
    setError(undefined);
    setSaved(null);
    setUndone(false);
    setOpen(true);
  }

  function save() {
    setError(undefined);
    start(async () => {
      const result = await updateActivity(values);
      if (result.error || !result.previous) return setError(result.error ?? "That didn't save");
      setOpen(false);
      setUndone(false);
      setSaved({ words: result.success ?? "Saved", previous: result.previous, at: Date.now() });
      router.refresh();
    });
  }

  function undo() {
    if (!saved) return;
    const previous = saved.previous;
    start(async () => {
      const result = await updateActivity(previous);
      if (result.error) return setError(result.error);
      setUndone(true);
      setSaved(null);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <>
        <button type="button" className="link text-[0.7rem] pointer-coarse:min-h-11" onClick={begin} data-testid="activity-edit">
          Edit
        </button>
        {saved && (
          <span role="status" className="inline-flex items-center gap-1.5 text-[0.7rem]" data-testid="activity-edit-saved">
            <span>{saved.words}</span>
            <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" disabled={pending} onClick={undo} data-testid="activity-edit-undo">
              {pending ? "Undoing…" : "Undo"}
            </button>
          </span>
        )}
        {undone && (
          <span role="status" className="faint text-[0.7rem]" data-testid="activity-edit-undone">
            Put back
          </span>
        )}
        {error && !open && (
          <span role="alert" className="text-[0.7rem] text-[var(--danger)]">
            {error}
          </span>
        )}
      </>
    );
  }

  return (
    <form
      className="mt-2 basis-full space-y-2 rounded-lg border border-[var(--border)] bg-[var(--tint-1)] p-3"
      data-testid="activity-edit-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="block text-xs" htmlFor={`${id}-body`}>
        What happened
      </label>
      <textarea
        id={`${id}-body`}
        className="input min-h-16 w-full text-sm"
        value={values.body}
        maxLength={5000}
        onChange={(event) => setValues({ ...values, body: event.target.value })}
        data-testid="activity-edit-body"
      />
      <div className="flex flex-wrap items-end gap-2">
        {outcomes.length > 0 && (
          <label className="text-xs">
            <span className="mb-1 block">How it went</span>
            <select
              className="input input-sm w-auto"
              value={values.outcome}
              onChange={(event) => setValues({ ...values, outcome: event.target.value })}
              data-testid="activity-edit-outcome"
            >
              <option value="">Not recorded</option>
              {outcomes.map((key) => (
                <option key={key} value={key}>
                  {ACTIVITY_OUTCOME_LABELS[key as ActivityOutcomeValue]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs">
          <span className="mb-1 block">Day</span>
          <input
            type="date"
            className="input input-sm w-40"
            value={values.on}
            max={today}
            required
            onChange={(event) => setValues({ ...values, on: event.target.value })}
            data-testid="activity-edit-on"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block">Time</span>
          <input
            type="time"
            className="input input-sm w-32"
            value={values.time}
            onChange={(event) => setValues({ ...values, time: event.target.value })}
            data-testid="activity-edit-time"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setOpen(false)} data-testid="activity-edit-cancel">
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm pointer-coarse:min-h-11" disabled={pending} data-testid="activity-edit-save">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
