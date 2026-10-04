"use client";

import { useState, useTransition } from "react";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, FOLLOW_UP_DAYS, type ActivityTypeValue } from "@/lib/constants";
import { addDays } from "@/lib/payments";
import type { FollowUpPick, FollowUpSeed } from "@/lib/logging";
import { FormError } from "@/components/ui";
import { IconCalendar, IconCheck } from "@/components/icons";
import { scheduleFollowUps } from "@/app/dashboard/contacts/actions";

// "Want to set a follow-up?" — the box that opens under the Log activity
// form the moment a call, text, email or meeting is logged (Oct 4, 2026).
// Tick what comes next (one or several), give each its day, and each one
// goes on the calendar as something to do with the same people. "No
// thanks" closes it and nothing is written. Drawn inline rather than as a
// dialog: it sits right where the person just clicked, and a page with
// nothing floating over it has nothing to make opaque.
export function FollowUpPrompt({
  seed,
  today,
  onClose,
}: {
  seed: FollowUpSeed;
  // Today in the workspace's zone, from the server, like the form above.
  today: string;
  // Called with the success line to show, or nothing when skipped.
  onClose: (message?: string) => void;
}) {
  const defaultOn = addDays(today, FOLLOW_UP_DAYS);
  const [picked, setPicked] = useState<Partial<Record<ActivityTypeValue, { on: string; time: string }>>>({});
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const toggle = (type: ActivityTypeValue) =>
    setPicked((previous) => {
      const next = { ...previous };
      if (next[type]) delete next[type];
      else next[type] = { on: defaultOn, time: "" };
      return next;
    });
  const set = (type: ActivityTypeValue, patch: Partial<{ on: string; time: string }>) =>
    setPicked((previous) => ({ ...previous, [type]: { ...(previous[type] ?? { on: defaultOn, time: "" }), ...patch } }));

  const items: FollowUpPick[] = ACTIVITY_TYPES.filter((type) => picked[type]).map((type) => ({
    type,
    on: picked[type]!.on,
    time: picked[type]!.time,
  }));

  const save = () =>
    start(async () => {
      setError(undefined);
      const result = await scheduleFollowUps(seed, items);
      if (result?.error) setError(result.error);
      else onClose(result?.success);
    });

  return (
    <div
      className="space-y-2.5 rounded-lg border border-[var(--border-strong)] bg-[rgb(255_255_255/0.03)] p-3"
      role="group"
      aria-label="Set a follow-up"
      data-testid="follow-up-prompt"
    >
      <div>
        <p className="text-sm font-medium">Want to set a follow-up{seed.primaryName ? ` with ${seed.primaryName}` : ""}?</p>
        <p className="faint text-xs">Tick what comes next and when. Each one goes on the calendar as something to do.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((type) => {
          const on = Boolean(picked[type]);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggle(type)}
              aria-pressed={on}
              className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
              data-testid={`follow-up-type-${type}`}
            >
              {on && <IconCheck size={12} />}
              {ACTIVITY_LABELS[type]}
            </button>
          );
        })}
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5" data-testid="follow-up-rows">
          {items.map((item) => (
            <div key={item.type} className="flex flex-wrap items-end gap-2" data-testid={`follow-up-row-${item.type}`}>
              <span className="w-24 pb-1.5 text-xs">{ACTIVITY_LABELS[item.type]}</span>
              <label className="block text-xs">
                <span className="faint block">When</span>
                <input
                  type="date"
                  value={item.on}
                  min={today}
                  onChange={(event) => set(item.type, { on: event.target.value || defaultOn })}
                  className="input input-sm"
                  data-testid={`follow-up-on-${item.type}`}
                />
              </label>
              <label className="block text-xs">
                <span className="faint block">Time · optional</span>
                <input
                  type="time"
                  value={item.time}
                  onChange={(event) => set(item.type, { time: event.target.value })}
                  className="input input-sm"
                  data-testid={`follow-up-time-${item.type}`}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || items.length === 0}
          onClick={save}
          className="btn btn-primary btn-sm"
          data-testid="follow-up-save"
        >
          <IconCalendar size={12} />
          {pending ? "Adding…" : items.length > 1 ? `Add ${items.length} to the calendar` : "Add to the calendar"}
        </button>
        <button type="button" disabled={pending} onClick={() => onClose()} className="btn btn-ghost btn-sm" data-testid="follow-up-skip">
          No thanks
        </button>
      </div>
    </div>
  );
}
