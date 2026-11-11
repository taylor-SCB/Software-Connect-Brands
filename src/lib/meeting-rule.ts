// Which meeting is waiting for an answer (integration fix, Nov 11, 2026).
// One rule for every screen: the Pipeline's tiles, Needs a decision and
// the panel, the contact page's header and Next step strip, the company
// page's main button, the "How did it go?" sheet, and a move out of
// Meeting Set. Pure and browser-safe; waitingMeetings() in
// src/lib/meetings.ts feeds it from the database, and meetingFocus() in
// deals/tile-line.ts from a tile's own meetings.
//
// - Answered: the meeting's own outcome, else the outcome on the history
//   line it was logged as (Held or No-show). A calendar entry ticked done
//   with no outcome ("Just tick it") answers nothing.
// - ahead: the soonest unanswered meeting whose moment is still to come.
// - last: the latest meeting whose moment has come, on a tile at Meeting
//   Set (only those wait for Held / No-show), with how it went.
// - due: `last`, when nobody answered it and nothing is booked ahead —
//   "Met Nov 6 — how did it go?" (health's meetingDue, the same rule).
// - missed: `last`, when it was a no-show and nothing is booked ahead —
//   "No-show Nov 6 — reschedule".
// - toAnswer: the meeting a Held / No-show / Rescheduled tap is about when
//   no meeting was named: the latest one that has come and nobody
//   answered (on any of their open tiles, even with one booked ahead: it is
//   the one that has happened), else the soonest one ahead (Held asks "Did
//   it happen early?"), else the missed one ("It did happen", as the
//   Pipeline tile says). Never none while one of these exists, so a Held
//   never writes a second meeting beside one already booked.

export type MeetingAnswer = "HELD" | "NO_SHOW" | null;

export type MeetingFact<T> = {
  item: T;
  // The meeting's moment, epoch milliseconds.
  at: number;
  outcome: MeetingAnswer;
  // The tile it is on sits at Meeting Set.
  meetingSet: boolean;
  // The tile is still open (not Won or Lost); a closed tile's meetings are
  // history, never what a tap answers. Asking about one tile: true.
  open?: boolean;
};

export type WaitingOf<T> = {
  ahead: T | null;
  last: { item: T; outcome: MeetingAnswer } | null;
  due: T | null;
  missed: T | null;
  toAnswer: T | null;
};

// HELD / NO_SHOW from either place; anything else is unanswered.
export function answerOf(own: string | null | undefined, logged: string | null | undefined): MeetingAnswer {
  const value = own ?? logged ?? null;
  return value === "HELD" || value === "NO_SHOW" ? value : null;
}

// Later, or as late and answered: two at the same moment, the answered one
// stands (health's lastmeet orders the same way).
function later<T>(meeting: MeetingFact<T>, than: MeetingFact<T> | null) {
  return !than || meeting.at > than.at || (meeting.at === than.at && than.outcome === null && meeting.outcome !== null);
}

export function waitingOf<T>(meetings: MeetingFact<T>[], now: number): WaitingOf<T> {
  let ahead: MeetingFact<T> | null = null;
  let aheadOpen: MeetingFact<T> | null = null;
  let last: MeetingFact<T> | null = null;
  let pastOpen: MeetingFact<T> | null = null;
  for (const meeting of meetings) {
    const open = meeting.open !== false;
    if (meeting.at > now) {
      if (meeting.outcome !== null) continue;
      if (!ahead || meeting.at < ahead.at) ahead = meeting;
      if (open && (!aheadOpen || meeting.at < aheadOpen.at)) aheadOpen = meeting;
      continue;
    }
    if (meeting.meetingSet && later(meeting, last)) last = meeting;
    if (open && meeting.outcome === null && (!pastOpen || meeting.at > pastOpen.at)) pastOpen = meeting;
  }
  const due = !ahead && last && last.outcome === null ? last.item : null;
  const missed = !ahead && last && last.outcome === "NO_SHOW" ? last.item : null;
  return {
    ahead: ahead?.item ?? null,
    last: last ? { item: last.item, outcome: last.outcome } : null,
    due,
    missed,
    toAnswer: pastOpen?.item ?? aheadOpen?.item ?? missed,
  };
}
