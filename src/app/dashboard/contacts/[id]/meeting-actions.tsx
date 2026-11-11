"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markMeetingHeld, markMeetingNoShow, rescheduleMeeting } from "@/app/dashboard/deals/opportunity-actions";
import { completeEventWithLog, moveEvent } from "@/app/dashboard/calendar/actions";
import { logActivity } from "../actions";
import { FloatingMenu } from "@/components/floating-menu";
import type { ContactMeeting } from "./contact-data";
import { useContactPage } from "./contact-shell";
import { Chip } from "./sheet";
import { dayChips, TIME_CHIPS } from "./day-chips";

// Held · No-show · Move for one meeting (BDR redesign, Nov 11, 2026). A
// meeting on the Pipeline goes through markMeetingHeld / markMeetingNoShow
// / rescheduleMeeting; one only on the calendar through the Done box's
// completeEventWithLog and moveEvent; a status set to Meeting Set by hand
// with no meeting anywhere is logged as a held meeting. A meeting still
// ahead asks "Did it happen early?" first. Every save shows "Saved · Undo".
export function useMeetingActions(meeting: ContactMeeting | null) {
  const router = useRouter();
  const page = useContactPage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<string | null>(null);

  function done(result: { success?: string; error?: string; batchId?: string }, fallback: string) {
    if (result.error) {
      setError(result.error);
      return false;
    }
    setConfirm(null);
    page.showToast({ message: result.success ?? fallback, batchId: result.batchId ?? null });
    router.refresh();
    return true;
  }

  function held(early = false) {
    setError(undefined);
    start(async () => {
      if (meeting?.meetingId) {
        const result = await markMeetingHeld(meeting.meetingId, early ? { early: true } : {});
        if (result.confirmEarly) return setConfirm(result.error ?? "This meeting is still ahead. Did it happen early?");
        done(result, "Held · Meeting Completed");
        return;
      }
      if (meeting?.eventId) {
        const result = await completeEventWithLog(meeting.eventId, { activityType: "MEETING", note: "", outcome: "HELD", ...(early ? { early: true } : {}) });
        if (result.confirmEarly) return setConfirm(result.error ?? "This meeting is still ahead. Did it happen early?");
        done(result, "Held · Meeting Completed");
        return;
      }
      const form = new FormData();
      form.set("contactId", page.contactId);
      form.set("type", "MEETING");
      form.set("outcome", "HELD");
      form.set("body", "");
      done(await logActivity({}, form), "Held · Meeting Completed");
    });
  }

  function noShow() {
    setError(undefined);
    start(async () => {
      if (meeting?.meetingId) done(await markMeetingNoShow(meeting.meetingId), "No-show · still Meeting Set");
      else if (meeting?.eventId)
        done(await completeEventWithLog(meeting.eventId, { activityType: "MEETING", note: "", outcome: "NO_SHOW" }), "No-show · still Meeting Set");
    });
  }

  function move(on: string, time: string | null, after?: () => void) {
    setError(undefined);
    start(async () => {
      if (meeting?.meetingId) {
        if (done(await rescheduleMeeting(meeting.meetingId, { on, time }), "Moved")) after?.();
      } else if (meeting?.eventId) {
        if (done(await moveEvent(meeting.eventId, on), "Moved")) after?.();
      }
    });
  }

  return { held, noShow, move, pending, error, confirm, cancelConfirm: () => setConfirm(null), canMark: Boolean(meeting?.meetingId || meeting?.eventId) };
}

// "This meeting is Tue Nov 17. Did it happen early?" Yes / Not yet.
export function EarlyConfirm({ text, onYes, onNo, pending }: { text: string; onYes: () => void; onNo: () => void; pending: boolean }) {
  return (
    <div role="alert" className="flex basis-full flex-wrap items-center gap-2 text-xs" data-testid="held-confirm-early">
      <span>{text}</span>
      <button type="button" className="btn btn-primary btn-sm pointer-coarse:min-h-11" disabled={pending} onClick={onYes} data-testid="held-early-yes">
        Yes, it happened
      </button>
      <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={onNo}>
        Not yet
      </button>
    </div>
  );
}

// "Move" / "Reschedule": a day chip, a time chip, Save.
export function MoveButton({
  label,
  onMove,
  pending,
  testId,
  className = "btn btn-ghost btn-sm pointer-coarse:min-h-11",
  withTime = true,
}: {
  label: string;
  onMove: (on: string, time: string | null, close: () => void) => void;
  pending: boolean;
  testId: string;
  className?: string;
  withTime?: boolean;
}) {
  const page = useContactPage();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chips = dayChips(page.today);
  const [on, setOn] = useState(chips[0].on);
  const [time, setTime] = useState<string | null>("10:00");
  return (
    <>
      <button ref={anchor} type="button" className={className} aria-expanded={open} onClick={() => setOpen(!open)} data-testid={testId}>
        {label}
      </button>
      <FloatingMenu anchor={anchor} open={open} onClose={() => setOpen(false)} width={300} label={label} testId={`${testId}-menu`}>
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Chip key={chip.on} on={on === chip.on} onClick={() => setOn(chip.on)} testId={`${testId}-day-${chip.on}`}>
                {chip.label}
              </Chip>
            ))}
          </div>
          <input
            type="date"
            value={on}
            min={page.today}
            onChange={(event) => setOn(event.target.value || page.today)}
            className="input input-sm w-44"
            aria-label="New day"
            data-testid={`${testId}-day`}
          />
          {withTime && (
            <div className="flex flex-wrap gap-1.5">
              {TIME_CHIPS.map((chip) => (
                <Chip key={chip.value} on={time === chip.value} onClick={() => setTime(chip.value)}>
                  {chip.label}
                </Chip>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary btn-sm pointer-coarse:min-h-11"
              disabled={pending || !on}
              onClick={() => onMove(on, withTime ? time : null, () => setOpen(false))}
              data-testid={`${testId}-save`}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </FloatingMenu>
    </>
  );
}
