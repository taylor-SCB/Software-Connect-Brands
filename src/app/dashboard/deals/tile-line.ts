import { aheadDay, isoDiff, shortDay, time12 } from "@/lib/health";
import type { PipelineColumn } from "@/lib/constants";

// What a Pipeline tile says on its third line and which one button it
// offers (BDR redesign, Release 7, Nov 11, 2026). Pure: the page works it
// out per tile from data it already loaded, and the board renders it.
//
// The Meeting Set column splits in two by the tile's meetings:
// - "Coming up": a meeting still ahead that nobody marked (sorted by its
//   date), or no meeting at all (last);
// - "Happened — how did it go?": the latest meeting has passed with none
//   ahead. Unmarked, it offers Held / No-show / Reschedule; a no-show
//   offers Reschedule first.
// The same rule is "Needs a decision" on the filter bar
// (decisionOpportunityIds in page.tsx counts it in SQL).

export type TileMeeting = {
  id: string;
  // The moment (OpportunityMeeting.on), ISO.
  at: string;
  // The workspace's day and "HH:MM" when a time was set.
  day: string;
  time: string | null;
  // HELD / NO_SHOW, from the meeting or the history line it was logged as.
  outcome: "HELD" | "NO_SHOW" | null;
};

export type MeetingFocus = {
  meeting: TileMeeting;
  // ahead: still to come; due: passed, nobody said; noshow / held: marked.
  kind: "ahead" | "due" | "noshow" | "held";
};

export type TileGroup = "coming" | "happened";

export type TileAction =
  | { kind: "decide" }
  | { kind: "reschedule"; label: string }
  | { kind: "move"; column: PipelineColumn; label: string }
  | { kind: "open"; label: string };

export type TileLine = { text: string; tone: "warn" | "plain"; key: string };

// The meeting a Meeting Set tile is about: the soonest one ahead, else the
// latest one that has passed.
export function meetingFocus(meetings: TileMeeting[], now: Date): MeetingFocus | null {
  const nowMs = now.getTime();
  const ahead = meetings
    .filter((meeting) => meeting.outcome === null && Date.parse(meeting.at) > nowMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (ahead[0]) return { meeting: ahead[0], kind: "ahead" };
  const past = meetings.filter((meeting) => Date.parse(meeting.at) <= nowMs).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!past[0]) return null;
  const kind = past[0].outcome === "HELD" ? "held" : past[0].outcome === "NO_SHOW" ? "noshow" : "due";
  return { meeting: past[0], kind };
}

export function groupOf(focus: MeetingFocus | null): TileGroup {
  return focus && focus.kind !== "ahead" ? "happened" : "coming";
}

// "$950", "$11.8k", "$1.2M".
export function compactDollars(cents: number) {
  const dollars = Math.round(cents / 100);
  const trim = (value: number) => value.toFixed(1).replace(/\.0$/, "");
  if (Math.abs(dollars) < 1000) return `$${dollars.toLocaleString("en-US")}`;
  if (Math.abs(dollars) < 1_000_000) return `$${trim(dollars / 1000)}k`;
  return `$${trim(dollars / 1_000_000)}M`;
}

function sentAgo(day: string, today: string) {
  const days = Math.max(0, isoDiff(today, day));
  return days === 0 ? "sent today" : `sent ${days}d`;
}

export function meetingWords(focus: MeetingFocus, today: string) {
  const { day, time } = focus.meeting;
  switch (focus.kind) {
    case "ahead": {
      const when = time12(time);
      return `Meeting ${aheadDay(day, today)}${when ? ` ${when}` : ""}`;
    }
    case "due":
      return `Met ${shortDay(day)} — how did it go?`;
    case "noshow":
      return `No-show ${shortDay(day)} — reschedule`;
    default:
      return `Held ${shortDay(day)} — move it on`;
  }
}

export function tileLine(input: {
  column: PipelineColumn | "ARCHIVED";
  focus: MeetingFocus | null;
  // The latest meeting that has passed, whatever the column.
  lastMet: TileMeeting | null;
  today: string;
  quietDays: number | null;
  valueCents: number;
  // The newest quote out for an answer, and a draft one, by total.
  sentQuote: { cents: number; day: string } | null;
  draftQuote: { cents: number } | null;
  contractSentDay: string | null;
  stageDay: string | null;
  // The health reason (owes, a closed reason) when it says more.
  owes: string | null;
  closedReason: string | null;
}): TileLine {
  const { column, today } = input;
  if (column === "MEETING_SET") {
    if (input.focus) return { text: meetingWords(input.focus, today), tone: input.focus.kind === "ahead" ? "plain" : "warn", key: input.focus.kind };
    return { text: "No meeting on the calendar — book one", tone: "warn", key: "none" };
  }
  if (input.quietDays !== null && column !== "WON" && column !== "LOST" && column !== "ARCHIVED") {
    return { text: `Quiet ${input.quietDays}d — call`, tone: "warn", key: "quiet" };
  }
  switch (column) {
    case "MEETING_COMPLETED":
      if (input.draftQuote) return { text: `Quote draft ${compactDollars(input.draftQuote.cents)} — send it`, tone: "plain", key: "draft" };
      if (input.lastMet) return { text: `Met ${shortDay(input.lastMet.day)} — start a quote`, tone: "plain", key: "met" };
      return { text: "Start a quote", tone: "plain", key: "met" };
    case "QUOTE_SENT": {
      const sent = input.sentQuote;
      const day = sent?.day ?? input.stageDay;
      return { text: `Quote ${compactDollars(sent?.cents ?? input.valueCents)}${day ? ` · ${sentAgo(day, today)}` : ""}`, tone: "plain", key: "quote" };
    }
    case "CONTRACT_SENT": {
      const day = input.contractSentDay ?? input.stageDay;
      return { text: `Contract ${compactDollars(input.valueCents)}${day ? ` · ${sentAgo(day, today)}` : ""}`, tone: "plain", key: "contract" };
    }
    case "ARCHIVED":
      return { text: "Archived · the contract went unanswered", tone: "plain", key: "archived" };
    case "WON":
      if (input.owes) return { text: input.owes, tone: "warn", key: "owes" };
      return { text: `Won ${compactDollars(input.valueCents)}${input.stageDay ? ` · ${shortDay(input.stageDay)}` : ""}`, tone: "plain", key: "won" };
    case "LOST":
      return { text: `Lost${input.closedReason ? ` · ${input.closedReason}` : ""}`, tone: "plain", key: "lost" };
    default:
      return { text: "", tone: "plain", key: "none" };
  }
}

const NEXT_MOVE: Partial<Record<PipelineColumn, { column: PipelineColumn; label: string }>> = {
  MEETING_COMPLETED: { column: "QUOTE_SENT", label: "Start a quote →" },
  QUOTE_SENT: { column: "CONTRACT_SENT", label: "Move to Contract →" },
  CONTRACT_SENT: { column: "WON", label: "Move to Won →" },
};

// The one button at the foot of a phone card (and the Happened tiles'
// three on every size).
export function tileAction(column: PipelineColumn | "ARCHIVED", focus: MeetingFocus | null): TileAction {
  if (column === "MEETING_SET") {
    if (!focus) return { kind: "move", column: "MEETING_COMPLETED", label: "Move to Meeting Completed →" };
    if (focus.kind === "ahead") return { kind: "reschedule", label: "Reschedule" };
    if (focus.kind === "held") return { kind: "move", column: "MEETING_COMPLETED", label: "Move to Meeting Completed →" };
    return { kind: "decide" };
  }
  const next = column === "ARCHIVED" ? null : NEXT_MOVE[column];
  if (next) return { kind: "move", ...next };
  return { kind: "open", label: "Open" };
}

// Coming up sorts by the meeting date, soonest first, with no date last;
// Happened puts the oldest unanswered first.
export function meetingSortKey(focus: MeetingFocus | null) {
  if (!focus) return "9999";
  return focus.meeting.at;
}

/* ---------------------- Day and time chips (Reschedule, Book) ---------------------- */

export function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
export function dayChips(today: string) {
  const chips: { on: string; label: string }[] = [{ on: addDays(today, 1), label: "Tomorrow" }];
  for (let n = 2; chips.length < 3 && n < 7; n += 1) {
    const on = addDays(today, n);
    const day = new Date(`${on}T12:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) chips.push({ on, label: weekday.format(new Date(`${on}T12:00:00Z`)) });
  }
  // Next Monday, or the one after when Monday is tomorrow.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const toMonday = (8 - dow) % 7 || 7;
  chips.push({ on: addDays(today, toMonday === 1 ? 8 : toMonday), label: "Next week" });
  return chips;
}
export const TIMES = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];

// "9 AM", "1 PM".
export function timeWords(value: string) {
  const hour = Number(value.slice(0, 2));
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}
