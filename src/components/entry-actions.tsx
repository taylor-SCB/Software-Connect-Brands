"use client";

import { useState, useTransition } from "react";
import { IconCalendar, IconCheck, IconTrash } from "@/components/icons";
import { rescheduleEntry } from "@/components/how-did-it-go/actions";
import { deleteEvent, handBackEvent } from "@/app/dashboard/calendar/actions";

// The three buttons on a scheduled row (Planner AI, Nov 12, 2026; Taylor):
// ✅ Done opens How did it go? (the host does that, through onDone), 📅
// Reschedule asks a day and an optional time with Save / Cancel, and the red
// trash asks Delete / Cancel. An entry a teammate put on your calendar
// (delegated) can't be deleted: the trash is "Hand back" to whoever made it,
// with Hand back / Cancel. Used on the Planner's Planned tab and on My day's
// Up next rows that have an entry.

export type EntryRef = {
  id: string;
  title: string;
  startOn: string;
  startTime: string | null;
  // Put on your calendar by someone else, who it would go back to.
  delegatedBy: string | null;
};

type Asking = null | "move" | "delete" | "handback";

export function EntryActions({
  entry,
  today,
  onDone,
  onChanged,
  compact = false,
}: {
  entry: EntryRef;
  today: string;
  onDone: () => void;
  onChanged: (words: string) => void;
  compact?: boolean;
}) {
  const [asking, setAsking] = useState<Asking>(null);
  const [on, setOn] = useState(entry.startOn < today ? today : entry.startOn);
  const [time, setTime] = useState(entry.startTime ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const btn = `btn btn-ghost btn-sm pointer-coarse:min-h-11 ${compact ? "px-2" : ""}`;

  function run(action: () => Promise<{ success?: string; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.error) {
        start(() => setError(result.error!));
        return;
      }
      start(() => {
        setAsking(null);
        onChanged(result.success ?? "Saved");
      });
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="entry-actions" data-entry-id={entry.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={btn} onClick={onDone} data-testid="entry-done" aria-label={`Done: ${entry.title}`}>
          <IconCheck size={14} />
          {!compact && "Done"}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            setError(null);
            setAsking(asking === "move" ? null : "move");
          }}
          data-testid="entry-reschedule"
          aria-expanded={asking === "move"}
          aria-label={`Reschedule ${entry.title}`}
        >
          <IconCalendar size={14} />
          {!compact && "Reschedule"}
        </button>
        {entry.delegatedBy ? (
          <button
            type="button"
            className={btn}
            onClick={() => {
              setError(null);
              setAsking(asking === "handback" ? null : "handback");
            }}
            data-testid="entry-handback"
            aria-label={`Hand ${entry.title} back to ${entry.delegatedBy}`}
          >
            Hand back
          </button>
        ) : (
          <button
            type="button"
            className={`${btn} text-[var(--danger)]`}
            onClick={() => {
              setError(null);
              setAsking(asking === "delete" ? null : "delete");
            }}
            data-testid="entry-delete"
            aria-label={`Delete ${entry.title}`}
          >
            <IconTrash size={14} />
          </button>
        )}
      </div>
      {asking === "move" && (
        <div className="flex flex-wrap items-end gap-2 text-sm" role="group" aria-label="Reschedule" data-testid="entry-move-form">
          <label className="flex flex-col gap-0.5">
            <span className="faint text-xs">New day</span>
            <input type="date" className="input input-sm" value={on} min={today} onChange={(e) => setOn(e.target.value)} data-testid="entry-move-day" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="faint text-xs">Time (optional)</span>
            <input type="time" className="input input-sm" value={time} onChange={(e) => setTime(e.target.value)} data-testid="entry-move-time" />
          </label>
          <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAsking(null)} disabled={pending} data-testid="entry-move-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm pointer-coarse:min-h-11"
            disabled={pending || !on}
            data-testid="entry-move-save"
            onClick={() => run(() => rescheduleEntry(entry.id, { on, time: time || null }))}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {asking === "delete" && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Delete" data-testid="entry-delete-confirm">
          <span className="min-w-0 flex-1">Delete “{entry.title}”?</span>
          <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAsking(null)} disabled={pending} data-testid="entry-delete-cancel">
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm pointer-coarse:min-h-11" disabled={pending} data-testid="entry-delete-yes" onClick={() => run(() => deleteEvent(entry.id))}>
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
      {asking === "handback" && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Hand back" data-testid="entry-handback-confirm">
          <span className="min-w-0 flex-1">
            {entry.delegatedBy} put this on your calendar. Hand it back to them?
          </span>
          <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAsking(null)} disabled={pending} data-testid="entry-handback-cancel">
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm pointer-coarse:min-h-11" disabled={pending} data-testid="entry-handback-yes" onClick={() => run(() => handBackEvent(entry.id))}>
            {pending ? "Handing back…" : "Hand back"}
          </button>
        </div>
      )}
      {error && (
        <p className="text-xs text-[var(--danger)]" role="alert" data-testid="entry-error">
          {error}
        </p>
      )}
    </div>
  );
}
