"use client";

import { UpcomingCard, type UpcomingEvent } from "@/components/upcoming-card";
import type { EventChoices } from "@/app/dashboard/calendar/event-form";
import type { UpcomingMeeting } from "./contact-data";
import { EarlyConfirm, MoveButton, useMeetingActions } from "./meeting-actions";

const BTN = "btn btn-ghost btn-sm pointer-coarse:min-h-11";

// Coming up on a contact's page (round 2, Nov 11, 2026): every row gets its
// buttons, not only the first one the Next step strip shows. A meeting
// gets Held · No-show · Move (the same actions as the strip: the Pipeline
// meeting when there is one, else the calendar entry; a meeting still
// ahead asks "Did it happen early?"), anything else Move. A meeting
// already answered offers Move only.
export function ContactUpcoming({
  events,
  choices,
  defaults,
  label,
  meetings,
  typeOrder,
}: {
  events: UpcomingEvent[];
  choices: EventChoices;
  defaults: { contactId?: string; companyId?: string; startOn: string; type?: string };
  label: string;
  meetings: Record<string, UpcomingMeeting>;
  typeOrder?: string[];
}) {
  return (
    <UpcomingCard
      events={events}
      choices={choices}
      phoneFold
      defaults={defaults}
      label={label}
      typeOrder={typeOrder}
      rowActions={(event) => <RowActions meeting={meetings[event.id] ?? null} />}
    />
  );
}

function RowActions({ meeting }: { meeting: UpcomingMeeting | null }) {
  const actions = useMeetingActions(meeting);
  if (!meeting) return null;
  const canAnswer = meeting.meeting && !meeting.answered;
  return (
    <>
      {canAnswer && (
        <>
          <button type="button" className={BTN} disabled={actions.pending} onClick={() => actions.held()} data-testid="upcoming-held">
            Held
          </button>
          <button type="button" className={BTN} disabled={actions.pending} onClick={actions.noShow} data-testid="upcoming-no-show">
            No-show
          </button>
        </>
      )}
      <MoveButton
        label="Move"
        testId="upcoming-move"
        pending={actions.pending}
        withTime={Boolean(meeting.meetingId)}
        initialTime={meeting.time}
        onMove={(on, time, close) => actions.move(on, time, close)}
      />
      {actions.confirm && <EarlyConfirm text={actions.confirm} pending={actions.pending} onYes={() => actions.held(true)} onNo={actions.cancelConfirm} />}
      {actions.error && !actions.confirm && (
        <p role="alert" className="basis-full text-xs text-[var(--danger)]">
          {actions.error}
        </p>
      )}
    </>
  );
}
