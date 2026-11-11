"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aheadDay, pastDay, time12 } from "@/lib/health";
import { pipelineHref } from "@/lib/pipeline-link";
import { completeEventWithLog } from "@/app/dashboard/calendar/actions";
import { markMeetingHeld, markMeetingNoShow } from "@/app/dashboard/deals/opportunity-actions";
import { UndoToast } from "@/components/how-did-it-go/undo-toast";
import type { MeetingItem } from "./load";

// My day's Meetings card (BDR redesign, Nov 11, 2026): today and the next
// 7 days with times, and any past one nobody closed out. A past one shows
// Held / No-show, one tap each, with "Saved · Undo". Held on a booked
// meeting goes through markMeetingHeld (Meeting Completed, credit to
// whoever booked it); an entry with no booked meeting behind it is ticked
// done through completeEventWithLog with the same outcome. Which past
// meeting still waits is waitingMeetings' rule (src/lib/meeting-rule.ts),
// read in load.ts; a row links to its Pipeline tile.
export function MeetingsCard({ meetings, today, readOnly }: { meetings: MeetingItem[]; today: string; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [toast, setToast] = useState<{ batchId: string; words: string; at: number } | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  function answer(row: MeetingItem, outcome: "HELD" | "NO_SHOW") {
    setError(null);
    setBusy(row.eventId);
    start(async () => {
      let result: { error?: string; success?: string; batchId?: string; confirmEarly?: string };
      if (row.meetingId) {
        result = outcome === "HELD" ? await markMeetingHeld(row.meetingId) : await markMeetingNoShow(row.meetingId);
        if (result.confirmEarly && window.confirm(result.confirmEarly)) result = await markMeetingHeld(row.meetingId, { early: true });
      } else {
        result = await completeEventWithLog(row.eventId, { activityType: "MEETING", note: "", outcome });
        if (result.confirmEarly && window.confirm(result.confirmEarly)) {
          result = await completeEventWithLog(row.eventId, { activityType: "MEETING", note: "", outcome, early: true });
        }
      }
      setBusy(null);
      if (result.error) {
        setError({ id: row.eventId, text: result.error });
        return;
      }
      if (result.batchId) {
        setToast({ batchId: result.batchId, words: outcome === "HELD" ? `Held · ${row.who ?? row.title}` : `No-show · ${row.who ?? row.title}`, at: Date.now() });
      }
      router.refresh();
    });
  }

  if (meetings.length === 0) {
    return (
      <p className="faint px-5 py-5 text-sm" data-testid="meetings-empty">
        No meetings this week.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-[var(--hairline-3)]" data-testid="meetings">
        {meetings.map((row) => {
          const when = row.on < today ? pastDay(row.on, today) : aheadDay(row.on, today);
          const time = time12(row.time);
          // Waiting for an answer by the one meeting rule (load.ts).
          const waiting = row.waiting;
          return (
            <li key={row.eventId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5" data-testid="meeting-row" data-event-id={row.eventId}>
              <div className="w-20 shrink-0 text-xs">
                <p className="font-medium capitalize">{when}</p>
                <p className="faint num">{time ?? "No time set"}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {row.opportunityId ? (
                    <Link href={pipelineHref(row.opportunityId)} className="hover:underline" data-testid="meeting-tile">
                      {row.title}
                    </Link>
                  ) : (
                    row.title
                  )}
                </p>
                {row.who && (
                  <p className="faint truncate text-xs">
                    {row.contactId ? (
                      <Link href={`/dashboard/contacts/${row.contactId}`} className="hover:underline">
                        {row.who}
                      </Link>
                    ) : (
                      row.who
                    )}
                  </p>
                )}
              </div>
              {row.done ? (
                <span className="faint text-xs" data-testid="meeting-done">
                  Done
                </span>
              ) : waiting && !readOnly ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm pointer-coarse:min-h-11"
                    disabled={pending}
                    onClick={() => answer(row, "HELD")}
                    data-testid="meeting-held"
                  >
                    {busy === row.eventId ? "Saving…" : "Held"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
                    disabled={pending}
                    onClick={() => answer(row, "NO_SHOW")}
                    data-testid="meeting-noshow"
                  >
                    No-show
                  </button>
                </div>
              ) : waiting ? (
                <span className="text-xs text-[var(--warn)]">How did it go?</span>
              ) : null}
              {error?.id === row.eventId && <p className="w-full text-xs text-[var(--danger)]">{error.text}</p>}
            </li>
          );
        })}
      </ul>
      <UndoToast saved={toast} onDone={dismiss} />
    </>
  );
}
