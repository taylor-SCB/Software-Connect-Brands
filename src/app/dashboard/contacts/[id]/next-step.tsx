"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleFollowUps } from "../actions";
import { FloatingMenu } from "@/components/floating-menu";
import { IconCalendar } from "@/components/icons";
import { ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";
import type { ContactMeeting } from "./contact-data";
import { useContactPage } from "./contact-shell";
import { EarlyConfirm, MoveButton, useMeetingActions } from "./meeting-actions";
import { Chip } from "./sheet";
import { dayChips, shiftDay } from "./day-chips";

// The first thing booked with them, from Coming up.
export type NextItem = { eventId: string; title: string; when: string; meeting: boolean };

const BTN = "btn btn-ghost btn-sm pointer-coarse:min-h-11";

// The Next step strip (BDR redesign): what happens next with this person,
// and the buttons for it. A meeting whose day has gone by unmarked comes
// first ("Met Nov 6 — how did it go?" Held · No-show · Move); then the
// first thing on Coming up (a meeting gets Held · No-show · Move, anything
// else Move and Log it); with nothing booked, "Nothing booked" with Book
// meeting and Set follow-up, plus "Try again in 30 days" once they have
// been tried six times and never reached.
export function NextStepStrip({
  due,
  next,
  first,
  park,
}: {
  due: ContactMeeting | null;
  next: ContactMeeting | null;
  first: NextItem | null;
  park: boolean;
}) {
  const page = useContactPage();
  // The meeting the buttons act on: the one that has happened unmarked,
  // else the first booked item when it is a meeting.
  const meeting: ContactMeeting | null = due
    ? due
    : first
      ? first.meeting
        ? next && next.eventId === first.eventId
          ? next
          : { meetingId: null, eventId: first.eventId, on: "", time: null, when: first.when, title: first.title, due: false }
        : { meetingId: null, eventId: first.eventId, on: "", time: null, when: first.when, title: first.title, due: false }
      : null;
  const actions = useMeetingActions(meeting);
  const isMeeting = Boolean(due) || Boolean(first?.meeting);

  let line: React.ReactNode;
  if (due) {
    line = (
      <>
        <strong>Met {due.when}</strong> — how did it go?
      </>
    );
  } else if (first) {
    line = (
      <>
        <strong>{first.title}</strong> · {first.when}
      </>
    );
  } else {
    line = <strong>Nothing booked</strong>;
  }

  return (
    <section className="card card-lit min-w-0 px-5 py-3.5" aria-label="Next step" data-testid="next-step" data-kind={due ? "due" : first ? (isMeeting ? "meeting" : "item") : "none"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="eyebrow w-full">Next step</p>
        <p className="min-w-0 flex-1 text-sm" data-testid="next-step-line">
          {line}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {(due || first) && isMeeting && (
            <>
              <button type="button" className={BTN} disabled={actions.pending} onClick={() => actions.held()} data-testid="next-held">
                Held
              </button>
              <button type="button" className={BTN} disabled={actions.pending} onClick={actions.noShow} data-testid="next-no-show">
                No-show
              </button>
            </>
          )}
          {(due || first) && (
            <MoveButton
              label="Move"
              testId="next-move"
              pending={actions.pending}
              withTime={Boolean(meeting?.meetingId)}
              onMove={(on, time, close) => actions.move(on, time, close)}
            />
          )}
          {first && !isMeeting && !due && (
            <button type="button" className={BTN} onClick={page.openLog} data-testid="next-log">
              Log it
            </button>
          )}
          {!due && !first && (
            <>
              <button type="button" className={BTN} onClick={page.openBook} data-testid="next-book">
                Book meeting
              </button>
              <FollowUpButton />
              {park && <ParkButton />}
            </>
          )}
        </div>
        {actions.confirm && <EarlyConfirm text={actions.confirm} pending={actions.pending} onYes={() => actions.held(true)} onNo={actions.cancelConfirm} />}
        {actions.error && !actions.confirm && (
          <p role="alert" className="basis-full text-xs text-[var(--danger)]">
            {actions.error}
          </p>
        )}
      </div>
    </section>
  );
}

const FOLLOW_LABELS: Record<ActivityTypeValue, string> = {
  PHONE_CALL: "Call",
  TEXT: "Text",
  EMAIL: "Email",
  MEETING: "Try to book a meeting",
};

// "Set follow-up": what (Call, Text, Email, Try to book a meeting) and the
// day; an open calendar entry with them, the same as the box after a log.
function FollowUpButton() {
  const router = useRouter();
  const page = useContactPage();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chips = dayChips(page.today);
  const [type, setType] = useState<ActivityTypeValue>("PHONE_CALL");
  const [on, setOn] = useState(chips[0].on);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  return (
    <>
      <button ref={anchor} type="button" className={BTN} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="next-follow-up">
        <IconCalendar size={12} />
        Set follow-up
      </button>
      <FloatingMenu anchor={anchor} open={open} onClose={() => setOpen(false)} width={320} label="Set a follow-up" testId="next-follow-up-menu">
        <div className="space-y-3 p-3">
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_TYPES.map((option) => (
              <Chip key={option} on={type === option} onClick={() => setType(option)} testId={`follow-type-${option}`}>
                {FOLLOW_LABELS[option]}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Chip key={chip.on} on={on === chip.on} onClick={() => setOn(chip.on)} testId={`follow-day-${chip.on}`}>
                {chip.label}
              </Chip>
            ))}
          </div>
          <input type="date" value={on} min={page.today} onChange={(event) => setOn(event.target.value || page.today)} className="input input-sm w-44" aria-label="Follow-up day" />
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary btn-sm pointer-coarse:min-h-11"
              disabled={pending}
              data-testid="follow-save"
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const result = await scheduleFollowUps(
                    { contactIds: [page.contactId], companyId: page.companyId, primaryName: page.name, about: "" },
                    [{ type, on, time: "" }],
                  );
                  if (result.error) return setError(result.error);
                  setOpen(false);
                  page.showToast({ message: result.success ?? "On the calendar" });
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </FloatingMenu>
    </>
  );
}

// "Try again in 30 days" (decision 12): parking only books a call then.
function ParkButton() {
  const router = useRouter();
  const page = useContactPage();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={BTN}
      disabled={pending}
      data-testid="next-park"
      onClick={() =>
        start(async () => {
          const result = await scheduleFollowUps(
            { contactIds: [page.contactId], companyId: page.companyId, primaryName: page.name, about: "Try again in 30 days" },
            [{ type: "PHONE_CALL", on: shiftDay(page.today, 30), time: "" }],
          );
          page.showToast({ message: result.error ?? result.success ?? "Try again in 30 days" });
          router.refresh();
        })
      }
    >
      Try again in 30 days
    </button>
  );
}
