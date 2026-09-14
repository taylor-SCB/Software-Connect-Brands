"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/ui";
import { IconCalendar } from "@/components/icons";
import { scheduleInstall } from "../../../calendar/actions";

// "Schedule install" on a scope of work. Two dates and it is booked, on
// the crew already assigned to that scope — no form about what kind of
// day it is, because everyone already knows.
export function ScheduleInstallForm({
  projectId,
  scopeId,
  scopeName,
  crewName,
  today,
}: {
  projectId: string;
  scopeId: string | null;
  scopeName: string;
  crewName: string | null;
  today: string;
}) {
  const [state, action, pending] = useActionState(scheduleInstall, {});
  const [open, setOpen] = useState(false);
  const [moreDays, setMoreDays] = useState(false);
  const id = (field: string) => `install-${scopeId ?? "job"}-${field}`;

  // Closes on a booking that worked, and only then, so the reason a
  // booking was refused stays on the screen. Adjusted during render
  // rather than in an effect: that is React's own advice, and it avoids
  // the flash of an open form over a day that is already booked.
  const [handled, setHandled] = useState(state.success);
  if (state.success !== handled) {
    setHandled(state.success);
    if (state.success) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm"
        data-testid="schedule-install"
      >
        <IconCalendar size={13} />
        Schedule install
      </button>
    );
  }

  return (
    <form action={action} className="w-full space-y-2" data-testid="schedule-install-form">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="scopeId" value={scopeId ?? ""} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs">
          <span className="faint block">{moreDays ? "First day" : "Day"}</span>
          <input
            id={id("startOn")}
            name="startOn"
            type="date"
            defaultValue={today}
            required
            className="input input-sm"
            data-testid="install-start"
          />
        </label>
        {moreDays ? (
          <label className="block text-xs">
            <span className="faint block">Last day</span>
            <input
              id={id("endOn")}
              name="endOn"
              type="date"
              className="input input-sm"
              data-testid="install-end"
            />
          </label>
        ) : (
          <input type="hidden" name="endOn" value="" />
        )}
        <label className="block text-xs">
          <span className="faint block">Start time · optional</span>
          <input
            id={id("startTime")}
            name="startTime"
            type="time"
            className="input input-sm"
            data-testid="install-start-time"
          />
        </label>
        <label className="block text-xs">
          <span className="faint block">Finish · optional</span>
          <input id={id("endTime")} name="endTime" type="time" className="input input-sm" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="install-save">
          {pending ? "Booking…" : "Book it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={moreDays}
          onChange={(fired) => setMoreDays(fired.target.checked)}
          data-testid="install-more-days"
        />
        <span className="muted">Takes more than a day</span>
      </label>
      <p className="faint text-xs">
        {crewName
          ? `${crewName} is on ${scopeName}, so the day goes to them.`
          : `Nobody is on ${scopeName} yet — book the day now and assign a crew on Crew & time.`}
      </p>
      <FormError message={state.error} />
    </form>
  );
}
