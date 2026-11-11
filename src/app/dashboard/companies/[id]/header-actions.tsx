"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconCalendar, IconMail, IconPhone } from "@/components/icons";
import { FloatingMenu } from "@/components/floating-menu";
import { FormError } from "@/components/ui";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import type { LeadHealth } from "@/lib/health";
import { markMeetingHeld, markMeetingNoShow, rescheduleMeeting } from "@/app/dashboard/deals/opportunity-actions";
import { completeEventWithLog } from "@/app/dashboard/calendar/actions";
import { useCompanyShell } from "./company-shell";

// What the one filled button does on a company page, worked out on the
// server from the meter's next step (meter.action) and the person it is
// about — the furthest person along, whose meter the company wears.
export type MainAction =
  | { kind: "call"; label: string; tel: string | null; contactId: string | null }
  | { kind: "book"; label: string; contactId: string | null }
  | { kind: "meeting"; label: string; href: string; meetingId: string | null; on: string }
  | { kind: "mark-held"; label: string; meetingId: string | null; entryId: string | null; contactId: string | null }
  | { kind: "link"; label: string; href: string }
  // "Copy signing link": the customer's signing page, copied.
  | { kind: "copy"; label: string; text: string; href: string }
  | { kind: "log"; label: string };

const ACTION_CLASS = "btn btn-primary pointer-coarse:min-h-11 max-sm:w-full max-sm:min-h-12!";

function useRunAction(action: MainAction) {
  const shell = useCompanyShell();
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [confirmEarly, setConfirmEarly] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Held: the Pipeline meeting row when there is one, else the calendar
  // entry ticked done as Held. A meeting still ahead asks first.
  function held(early = false) {
    if (action.kind !== "mark-held") return;
    setError(undefined);
    start(async () => {
      if (action.meetingId) {
        const result = await markMeetingHeld(action.meetingId, { early });
        if (result.confirmEarly) return setConfirmEarly(result.confirmEarly);
        if (result.error) return setError(result.error);
        setConfirmEarly(null);
        shell.saved({ message: result.success ?? "Held · Meeting Completed", batchId: result.batchId });
        return;
      }
      if (action.entryId) {
        const result = await completeEventWithLog(action.entryId, { activityType: "MEETING", note: "Held", outcome: "HELD", early });
        if (result.confirmEarly) return setConfirmEarly(result.confirmEarly);
        if (result.error) return setError(result.error);
        setConfirmEarly(null);
        shell.saved({ message: result.success ?? "Held", batchId: result.batchId });
        return;
      }
      shell.openLog("MEETING");
    });
  }

  function noShow() {
    if (action.kind !== "mark-held") return;
    setError(undefined);
    start(async () => {
      if (action.meetingId) {
        const result = await markMeetingNoShow(action.meetingId);
        if (result.error) return setError(result.error);
        shell.saved({ message: result.success ?? "No-show", batchId: result.batchId });
        return;
      }
      if (action.entryId) {
        const result = await completeEventWithLog(action.entryId, { activityType: "MEETING", note: "No-show", outcome: "NO_SHOW" });
        if (result.error) return setError(result.error);
        shell.saved({ message: result.success ?? "No-show", batchId: result.batchId });
      }
    });
  }

  function run() {
    switch (action.kind) {
      case "call":
        if (action.contactId) shell.setRowLog(action.contactId, "PHONE_CALL");
        else shell.openLog("PHONE_CALL");
        return;
      case "book":
        shell.book(action.contactId);
        return;
      case "mark-held":
        held();
        return;
      case "log":
        shell.openLog();
        return;
      case "copy": {
        const link = `${window.location.origin}${action.text}`;
        navigator.clipboard
          ?.writeText(link)
          .then(() => shell.saved({ message: "Signing link copied" }))
          .catch(() => router.push(action.href));
        if (!navigator.clipboard) router.push(action.href);
        return;
      }
      default:
        router.push("href" in action ? action.href : "#");
    }
  }

  return { run, held, noShow, error, confirmEarly, setConfirmEarly, pending };
}

// The action bar: one filled button that follows the stage, then Call main
// line, Email and ⋯ More (Add person, Edit, Merge, Set status by hand,
// Delete at the foot). More opens a row of those under the bar, in place,
// so each keeps its own panel and confirm.
//
// Under it, the header meter: the furthest person's steps in the warmest
// person's colour. Tapping its next step runs the same action as the main
// button. `children` sits under the meter ("2 of 7 people reached").
export function HeaderActions({
  action,
  health,
  mainLine,
  email,
  more,
  children,
}: {
  action: MainAction;
  health: LeadHealth;
  mainLine: string | null;
  email: string | null;
  more: React.ReactNode;
  children?: React.ReactNode;
}) {
  const shell = useCompanyShell();
  const run = useRunAction(action);
  const href = action.kind === "link" || action.kind === "meeting" ? action.href : undefined;

  return (
    <div className="space-y-3" data-main-action={action.kind}>
      <div className="flex flex-wrap items-center gap-2" data-testid="company-actions">
        <MainButton action={action} run={run} />
        {mainLine && !(action.kind === "call" && action.tel === `tel:${mainLine}`) && (
          <a href={`tel:${mainLine}`} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="company-call-main">
            <IconPhone size={13} />
            Call main line
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="company-email">
            <IconMail size={13} />
            Email
          </a>
        )}
        <button
          type="button"
          onClick={() => shell.setMoreOpen(!shell.moreOpen)}
          aria-expanded={shell.moreOpen}
          aria-controls="company-more-tray"
          className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
          data-testid="company-more"
        >
          <span aria-hidden="true">⋯</span> More
        </button>
      </div>
      {run.confirmEarly && <ConfirmEarly day={run.confirmEarly} onYes={() => run.held(true)} onNo={() => run.setConfirmEarly(null)} pending={run.pending} />}
      <FormError message={run.error} />
      <div
        id="company-more-tray"
        role="group"
        aria-label="More actions"
        hidden={!shell.moreOpen}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--hairline-3)] bg-[var(--tint-1)] p-2"
        data-testid="company-more-tray"
      >
        {more}
      </div>
      <LifecycleMeter health={health} size="header" onNext={href ? undefined : () => run.run()} nextHref={href} testId="company-meter" className="pt-1" />
      {children}
    </div>
  );
}

function ConfirmEarly({ day, onYes, onNo, pending }: { day: string; onYes: () => void; onNo: () => void; pending: boolean }) {
  const words = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="alert" data-testid="company-confirm-early">
      <span>This meeting is {words}. Did it happen early?</span>
      <button type="button" disabled={pending} onClick={onYes} className="btn btn-primary btn-sm pointer-coarse:min-h-11" data-testid="company-confirm-early-yes">
        Yes, it happened
      </button>
      <button type="button" onClick={onNo} className="btn btn-ghost btn-sm pointer-coarse:min-h-11">
        No
      </button>
    </div>
  );
}

function MainButton({ action, run }: { action: MainAction; run: ReturnType<typeof useRunAction> }) {
  const common = { "data-testid": "company-main", "data-action": action.kind } as const;
  if (action.kind === "call" && action.tel) {
    return (
      <a href={action.tel} onClick={() => run.run()} className={ACTION_CLASS} {...common}>
        <IconPhone size={14} />
        {action.label}
      </a>
    );
  }
  if (action.kind === "meeting") {
    return (
      <>
        <Link href={action.href} className={ACTION_CLASS} {...common}>
          <IconCalendar size={14} />
          {action.label}
        </Link>
        {action.meetingId && <Reschedule meetingId={action.meetingId} on={action.on} />}
      </>
    );
  }
  if (action.kind === "link") {
    return (
      <Link href={action.href} className={ACTION_CLASS} {...common}>
        {action.label}
      </Link>
    );
  }
  return (
    <>
      <button type="button" disabled={run.pending} onClick={() => run.run()} className={ACTION_CLASS} {...common}>
        {action.kind === "call" && <IconPhone size={14} />}
        {action.kind === "book" && <IconCalendar size={14} />}
        {run.pending ? "Saving…" : action.label}
      </button>
      {action.kind === "mark-held" && (action.meetingId || action.entryId) && (
        <button type="button" disabled={run.pending} onClick={() => run.noShow()} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="company-no-show">
          No-show
        </button>
      )}
    </>
  );
}

// "Meeting Tue 10:00 AM" with Reschedule: a new day (and time) for the
// meeting on the Pipeline.
function Reschedule({ meetingId, on }: { meetingId: string; on: string }) {
  const shell = useCompanyShell();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(on);
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="company-reschedule">
        Reschedule
      </button>
      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={280} label="Reschedule" testId="company-reschedule-panel">
        <div className="space-y-2 p-3">
          <label className="block text-xs">
            <span className="faint mb-1 block">New day</span>
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className="input input-sm" />
          </label>
          <label className="block text-xs">
            <span className="faint mb-1 block">Time · optional</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="input input-sm" />
          </label>
          <FormError message={error} />
          <button
            type="button"
            disabled={pending || !day}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const result = await rescheduleMeeting(meetingId, { on: day, time: time || null });
                if (result.error) return setError(result.error);
                setOpen(false);
                shell.saved({ message: result.success ?? "Moved", batchId: result.batchId });
              })
            }
            className="btn btn-primary btn-sm w-full pointer-coarse:min-h-11"
          >
            {pending ? "Moving…" : "Move it"}
          </button>
        </div>
      </FloatingMenu>
    </>
  );
}
