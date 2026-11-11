import { daysSince } from "@/lib/format";
import { STATUS_REASON_LABELS } from "@/lib/constants";

// Lead health (BDR redesign, Nov 11, 2026; Taylor approved the plan's
// healthScore section as written). How warm a relationship is, kept apart
// from how far along it is: the lifecycle meter's length is the stage, its
// colour is this. Worked out when a page loads from what the app already
// stores and never saved, so it can be tuned without touching the
// database. One dial: the workspace's quiet days (Q, Settings → General),
// the same number that drives "Gone quiet". Days are calendar days in the
// workspace's time zone.
//
// Pure: no database, no React, safe to import from client components and
// from scripts/health-check.ts. src/lib/health-load.ts fills HealthInput
// for a page of contacts, companies or opportunities in a few grouped
// queries.
//
// States (step 1 of the plan):
// - NEW: never touched. Grey outline, "Not tried yet". Never red.
// - TRYING: touched, never reached. Grey, amber when stalled (a follow-up
//   late, or nothing booked and the last try more than Q days old). Never
//   red, never a number: a score for someone nobody has spoken to would be
//   made up.
// - REACHED: talked, replied or met at least once, or at Connected /
//   Interested / Meeting Set or further. Scored 0-100.
// - WON: a green check; red "Owes $X · N days late" when signed money is
//   past due (the same owed rows as the Owed to you tile).
// - CLOSED: Not Interested, Lost or Archived. Grey, with the reason.
//
// Score (REACHED only) = Recent touch (40 / 25 / 10 / 0) + Last talk
// (30 / 20 / 10, minus 10 after 5+ tries since the last talk) + Next step
// (30 / 15 / 0) - Drag (15). Warm 70+, Cooling 40-69, Cold under 40.

/* --------------------------------- Types --------------------------------- */

export type HealthState = "NEW" | "TRYING" | "REACHED" | "WON" | "CLOSED";
// The colour: teal, amber, rose, grey. Fixed on every tenant.
export type HealthTone = "good" | "warn" | "risk" | "none";
export type HealthBand = "WARM" | "COOLING" | "COLD";
export type HealthWordValue = "New" | "Trying" | "Warm" | "Cooling" | "Cold" | "Won" | "Closed";

// The kind of thing booked next, in the words the reason sentence uses.
export type NextKind = "meeting" | "call" | "text" | "email" | "follow-up" | string;

export type HealthContext = {
  now: Date;
  timeZone: string;
  // Organization.quietDays (Q).
  quietDays: number;
  // Organization.parkAfterTries: from this many tries with no connect the
  // row offers "Try again in 30 days".
  parkAfterTries: number;
};

export type StatusMove = {
  // The status moved into.
  to: string;
  on: Date;
  // Who moved it, when a person did.
  by: string | null;
  auto: boolean;
  reason: string | null;
};

export type HealthInput = {
  // ContactStatus value; for an opportunity, its Pipeline column.
  status: string;
  // For "try someone else at Ridgeline".
  companyName?: string | null;
  createdAt?: Date | null;
  // Touches: calls, texts, emails and meetings dated now or earlier, never
  // a marketing send or a no-show, counted once per batch.
  tries: number;
  talks: number;
  meetings: number;
  byType?: { calls: number; texts: number; emails: number; meetings: number };
  firstTouchAt: Date | null;
  lastTouchAt: Date | null;
  lastTouchBy?: { id: string; name: string } | null;
  // Connects: an outcome of TALKED / REPLIED / HELD, or a meeting with no
  // outcome dated now or earlier.
  firstConnectAt: Date | null;
  lastConnectAt: Date | null;
  // The latest move into Connected, Interested, Not Interested, Meeting
  // Set or Meeting Completed: each takes a conversation, so it stands in
  // for a talk the outcome data doesn't have (old records).
  statusTalkAt: Date | null;
  // Tries after the later of lastConnectAt / statusTalkAt.
  triesSinceTalk: number;
  // The soonest thing booked today or later: an open calendar entry, a
  // touch dated ahead, or a meeting on their opportunity. `on` is the
  // workspace's yyyy-mm-dd, `time` its "HH:MM".
  next: { on: string; time: string | null; kind: NextKind } | null;
  // Open follow-ups whose day has gone by unticked.
  overdue: { count: number; oldestOn: string } | null;
  // The latest meeting dated now or earlier, and whether anyone marked it
  // Held or No-show.
  lastMeeting: { at: Date; marked: boolean } | null;
  // Quotes and contracts out for an answer (status Sent).
  paperwork: { kind: "quote" | "contract"; sentAt: Date }[];
  // Signed Money-in paperwork (owedRowsSql): billed, received, and what is
  // past due.
  owed: { billedCents: number; receivedCents: number; lateCents: number; oldestLateOn: string | null } | null;
  // Every status change, oldest first, for the meter's step dates and the
  // reason something was closed.
  changes: StatusMove[];
};

export type MeterStepState = "done" | "current" | "next" | "todo" | "closed";

export type MeterStep = {
  name: string;
  state: MeterStepState;
  // "Oct 12" — only on reached steps, and not repeated when the ladder
  // passed through two steps on the same day.
  date: string | null;
  // Who moved it there ("auto" when the app did).
  by: string | null;
  // Quote, Contract and Won are moved by the paperwork, not by a tap.
  readOnly: boolean;
  hint: string | null;
};

export type MeterState = {
  // -1 (not touched) .. 6 (Won). For a closed record, the last step it
  // reached before it closed.
  step: number;
  interested: boolean;
  won: boolean;
  closed: { at: number; label: string; reason: string | null } | null;
  steps: MeterStep[];
  // "Meeting Set", and what comes after it, for the phone header.
  current: string | null;
  nextStep: string | null;
  // The one action the header button carries, by stage.
  action: { key: MeterActionKey; label: string } | null;
};

export type MeterActionKey =
  | "call"
  | "book"
  | "meeting"
  | "mark-held"
  | "start-quote"
  | "quote-yes"
  | "signing-link"
  | "deposit";

export type LeadHealth = {
  state: HealthState;
  tone: HealthTone;
  word: HealthWordValue;
  mark: string;
  // REACHED only.
  score: number | null;
  band: HealthBand | null;
  parts: { recent: number; talk: number; next: number; drag: number } | null;
  // "Recent 25 · Talk 30 · Next step 0 = 55"; null when there is no score.
  breakdown: string | null;
  reason: string;
  reasonKey: ReasonKey;
  // TRYING that has stalled (amber).
  stalled: boolean;
  // Never reached after Organization.parkAfterTries tries: offer "Try
  // again in 30 days".
  park: boolean;
  // "7 tries · 2 talks · 1 meeting · last touch 2d" (headers).
  caption: string;
  // "4 tries · 1 talk · 6d" (mini meter, list rows).
  miniCaption: string;
  counts: {
    tries: number;
    talks: number;
    meetings: number;
    byType: { calls: number; texts: number; emails: number; meetings: number } | null;
    lastTouchDays: number | null;
    lastTouchBy: { id: string; name: string } | null;
  };
  // What is booked next, in words ("meeting Tue 10:00 AM").
  nextText: string | null;
  owes: { cents: number; daysLate: number; text: string } | null;
  // Won: "Collected $0 of $6,754".
  collected: string | null;
  meter: MeterState;
  // The meter's full aria-label: "Stage: Meeting Set, 3 of 7. Health:
  // Cooling. Did the Nov 6 meeting happen?"
  label: string;
};

export type ReasonKey =
  | "owes"
  | "late"
  | "meeting"
  | "paperwork"
  | "quiet"
  | "tries"
  | "talked"
  | "park"
  | "stalled"
  | "trying"
  | "new"
  | "won"
  | "closed";

/* ------------------------------- Constants ------------------------------- */

// The seven steps, in the ladder's own words (Contacted reads "Attempted",
// approved Nov 11, 2026).
export const METER_STEPS = [
  "Attempted",
  "Connected",
  "Meeting Set",
  "Meeting Completed",
  "Quote Sent",
  "Contract Sent",
  "Won",
] as const;

// Where each status puts the meter. Interested is a mark on Connected.
const STEP_OF_STATUS: Record<string, number> = {
  NOT_ACTIONED: -1,
  CONTACTED: 0,
  CONNECTED: 1,
  INTERESTED: 1,
  NOT_INTERESTED: 1,
  MEETING_SET: 2,
  MEETING_COMPLETED: 3,
  QUOTE_SENT: 4,
  CONTRACT_SENT: 5,
  WON: 6,
};

// At or past Connected and still open.
const REACHED_STATUSES = new Set(["CONNECTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"]);

// A move into one of these took a conversation. Paperwork steps (Quote
// Sent, Contract Sent, Won) are moved by sending or signing, which is not
// a talk, so they never stand in for one.
export const TALK_STATUSES = ["CONNECTED", "INTERESTED", "NOT_INTERESTED", "MEETING_SET", "MEETING_COMPLETED"] as const;

const CLOSED_LABELS: Record<string, string> = {
  NOT_INTERESTED: "Not Interested",
  LOST: "Lost",
  ARCHIVED: "Archived",
};

const READ_ONLY_HINTS: Record<number, string> = {
  4: "Moves when the quote goes out",
  5: "Moves when the contract goes out",
  6: "Moves when the contract is signed",
};

export const HEALTH_MARKS: Record<HealthWordValue, string> = {
  Warm: "●",
  Cooling: "◐",
  Cold: "▲",
  Trying: "○",
  New: "○",
  Won: "✓",
  Closed: "×",
};

/* --------------------------- Days, dates, words --------------------------- */

const isoParts = new Map<string, Intl.DateTimeFormat>();

// The yyyy-mm-dd a moment falls on in the workspace's zone.
export function zoneDay(at: Date, timeZone: string): string {
  let formatter = isoParts.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
    } catch {
      formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Chicago" });
    }
    isoParts.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const timeParts = new Map<string, Intl.DateTimeFormat>();

// "HH:MM" on the workspace's clock for a moment.
export function zoneTime(at: Date, timeZone: string): string {
  let formatter = timeParts.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", { hourCycle: "h23", hour: "2-digit", minute: "2-digit", timeZone });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", { hourCycle: "h23", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" });
    }
    timeParts.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

function isoNumber(iso: string) {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;
}

// Whole calendar days from one yyyy-mm-dd to another.
export function isoDiff(later: string, earlier: string) {
  return Math.round(isoNumber(later) - isoNumber(earlier));
}

const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

// "Nov 6".
export function shortDay(iso: string) {
  return shortFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

function weekday(iso: string) {
  return weekdayFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

// A day ahead: "today", "tomorrow", "Thu" within the week, else "Nov 19".
export function aheadDay(iso: string, today: string) {
  const days = isoDiff(iso, today);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return weekday(iso);
  return shortDay(iso);
}

// A day behind: "today", "yesterday", "Tue" within the week, else "Oct 12".
export function pastDay(iso: string, today: string) {
  const days = isoDiff(today, iso);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return weekday(iso);
  return shortDay(iso);
}

// "10:00" → "10:00 AM": one 12-hour format everywhere the meter speaks.
export function time12(value: string | null | undefined) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });

// "$3,377": whole dollars, the way the money tiles read.
export function wholeDollars(cents: number) {
  return dollars.format(Math.round(cents / 100));
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function ago(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function shortAgo(days: number) {
  return days <= 0 ? "today" : `${days}d`;
}

function later(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// "meeting Tue 10:00 AM", "call tomorrow", "follow-up Nov 19".
export function nextWords(next: NonNullable<HealthInput["next"]>, today: string) {
  const day = aheadDay(next.on, today);
  const time = time12(next.time);
  const longDay = isoDiff(next.on, today) >= 7;
  return `${next.kind} ${day}${time ? `${longDay ? "," : ""} ${time}` : ""}`;
}

// A calendar entry's type in the reason sentence's words.
export function nextKindOf(type: string): NextKind {
  const t = type.trim().toLowerCase();
  if (t === "meeting" || t === "project meeting" || t === "site walk") return t === "site walk" ? "site walk" : "meeting";
  if (t === "call" || t === "phone call" || t === "phone_call") return "call";
  if (t === "text") return "text";
  if (t === "email") return "email";
  if (t.includes("follow")) return "follow-up";
  return t;
}

/* ------------------------------- The meter ------------------------------- */

export function stepOfStatus(status: string): number {
  return STEP_OF_STATUS[status] ?? -1;
}

function buildMeter(
  input: HealthInput,
  ctx: HealthContext,
  flags: { hasTouch: boolean; hasConnect: boolean; meetingDue: boolean; nextText: string | null; owedOpen: boolean },
): MeterState {
  const status = input.status;
  const closedLabel = CLOSED_LABELS[status] ?? null;
  const won = status === "WON";
  const now = ctx.now.getTime();

  // The earliest move into each step, and who made it.
  const firstInto: ({ on: Date; by: string | null; auto: boolean } | null)[] = Array.from({ length: 7 }, () => null);
  let furthest = -1;
  for (const change of input.changes) {
    if (change.on.getTime() > now) continue;
    const step = STEP_OF_STATUS[change.to];
    if (step === undefined || step < 0 || change.to === "NOT_INTERESTED") continue;
    furthest = Math.max(furthest, step);
    const seen = firstInto[step];
    if (!seen || change.on.getTime() < seen.on.getTime()) firstInto[step] = { on: change.on, by: change.by, auto: change.auto };
  }
  // A stored touch is Attempted and a stored connect is Connected, even
  // before the status ladder caught up (the plan's Release 1 stand-in:
  // later releases only ever add connects, so meters fill further and
  // never empty).
  if (!firstInto[0] && input.firstTouchAt) firstInto[0] = { on: input.firstTouchAt, by: null, auto: true };
  if (!firstInto[1] && input.firstConnectAt) firstInto[1] = { on: input.firstConnectAt, by: null, auto: true };
  if (flags.hasTouch) furthest = Math.max(furthest, 0);
  if (flags.hasConnect) furthest = Math.max(furthest, 1);

  let step: number;
  let closed: MeterState["closed"] = null;
  if (closedLabel) {
    const at = status === "NOT_INTERESTED" ? Math.max(1, furthest) : Math.max(0, furthest);
    let reason: string | null = null;
    for (const change of input.changes) if (change.to === status && change.reason) reason = reasonWords(change.reason);
    closed = { at, label: closedLabel, reason };
    step = at;
  } else {
    step = stepOfStatus(status);
    if (flags.hasTouch) step = Math.max(step, 0);
    if (flags.hasConnect) step = Math.max(step, 1);
  }

  const steps: MeterStep[] = [];
  let previousDay: string | null = null;
  for (let index = 0; index < 7; index += 1) {
    const reached = closed ? index <= closed.at : index <= step;
    let state: MeterStepState;
    if (closed) state = reached ? "closed" : "todo";
    // Won: all seven filled; nothing left to breathe.
    else if (won) state = "done";
    else if (index < step) state = "done";
    else if (index === step) state = "current";
    else if (index === step + 1) state = "next";
    else state = "todo";
    const into = reached ? firstInto[index] : null;
    let date: string | null = null;
    if (into) {
      const day = zoneDay(into.on, ctx.timeZone);
      date = day === previousDay ? null : shortDay(day);
      previousDay = day;
    }
    steps.push({
      name: METER_STEPS[index],
      state,
      date,
      by: into ? (into.auto ? "auto" : into.by) : null,
      readOnly: index >= 4,
      hint: READ_ONLY_HINTS[index] ?? null,
    });
  }

  const current = closed ? null : step >= 0 ? METER_STEPS[step] : null;
  const nextStep = closed || won ? null : step + 1 <= 6 ? METER_STEPS[step + 1] : null;

  let action: MeterState["action"] = null;
  if (!closed) {
    if (step <= 0) action = { key: "call", label: "Call" };
    else if (step === 1) action = { key: "book", label: "Book meeting" };
    else if (step === 2) {
      action = flags.meetingDue
        ? { key: "mark-held", label: "Mark held" }
        : flags.nextText && flags.nextText.startsWith("meeting")
          ? { key: "meeting", label: `Meeting ${flags.nextText.slice("meeting ".length)}` }
          : { key: "mark-held", label: "Mark held" };
    } else if (step === 3) action = { key: "start-quote", label: "Start a quote" };
    else if (step === 4) action = { key: "quote-yes", label: "Customer said yes" };
    else if (step === 5) action = { key: "signing-link", label: "Copy signing link" };
    else if (won && flags.owedOpen) action = { key: "deposit", label: "Send deposit invoice" };
  }

  return { step, interested: status === "INTERESTED", won, closed, steps, current, nextStep, action };
}

// StatusChange.reason holds a key (PRICE, HAS_VENDOR … from
// STATUS_REASONS); show its words. Anything else (older free text) shows
// as written.
export function reasonWords(reason: string): string {
  return (STATUS_REASON_LABELS as Record<string, string | undefined>)[reason] ?? reason;
}

export function meterLabel(meter: MeterState, word: string, reason: string) {
  let stage: string;
  if (meter.closed) stage = `${meter.closed.label}, after ${METER_STEPS[meter.closed.at]}`;
  else if (meter.step < 0) stage = "not touched yet";
  else stage = `${METER_STEPS[meter.step]}${meter.interested ? " · Interested" : ""}, ${meter.step + 1} of 7`;
  return `Stage: ${stage}. Health: ${word}. ${reason}`;
}

/* ------------------------------- The score ------------------------------- */

export function recentPoints(days: number | null, quietDays: number) {
  if (days === null) return 0;
  if (days <= 2) return 40;
  if (days <= quietDays / 2) return 25;
  if (days <= quietDays) return 10;
  return 0;
}

export function talkPoints(days: number | null, quietDays: number, triesSinceTalk: number) {
  let points = days === null ? 10 : days <= quietDays ? 30 : days <= quietDays * 2 ? 20 : 10;
  if (triesSinceTalk >= 5) points -= 10;
  return Math.max(0, points);
}

export function bandOf(score: number): HealthBand {
  if (score >= 70) return "WARM";
  if (score >= 40) return "COOLING";
  return "COLD";
}

const BAND_WORD: Record<HealthBand, HealthWordValue> = { WARM: "Warm", COOLING: "Cooling", COLD: "Cold" };
const BAND_TONE: Record<HealthBand, HealthTone> = { WARM: "good", COOLING: "warn", COLD: "risk" };

/* ------------------------------ leadHealth() ------------------------------ */

export function leadHealth(input: HealthInput, ctx: HealthContext): LeadHealth {
  const Q = Math.max(1, Math.round(ctx.quietDays || 8));
  const tz = ctx.timeZone;
  const now = ctx.now;
  const today = zoneDay(now, tz);
  const status = input.status;

  const daysAgo = (at: Date | null) => (at ? Math.max(0, daysSince(at, tz, now)) : null);
  const lastTouchDays = daysAgo(input.lastTouchAt);
  const statusTalk = input.statusTalkAt && input.statusTalkAt.getTime() <= now.getTime() ? input.statusTalkAt : null;
  const lastTalkAt = later(input.lastConnectAt, statusTalk);
  const lastTalkDays = daysAgo(lastTalkAt);

  const hasTouch = input.tries > 0 || input.lastTouchAt !== null;
  const hasConnect = input.lastConnectAt !== null || input.talks > 0;

  const next = input.next && isoDiff(input.next.on, today) >= 0 ? input.next : null;
  const nextText = next ? nextWords(next, today) : null;
  const paperRecent = input.paperwork.filter((paper) => (daysAgo(paper.sentAt) ?? 0) <= Q);
  const paperDrag = input.paperwork
    .filter((paper) => (daysAgo(paper.sentAt) ?? 0) > Q && (!input.lastTouchAt || input.lastTouchAt.getTime() < paper.sentAt.getTime()))
    // A contract waiting on a signature is the louder of the two; then the
    // one that has waited longest.
    .sort((a, b) => (a.kind === b.kind ? a.sentAt.getTime() - b.sentAt.getTime() : a.kind === "contract" ? -1 : 1));
  const late = input.overdue && input.overdue.count > 0 ? input.overdue : null;
  const lateDays = late ? Math.max(1, isoDiff(today, late.oldestOn)) : 0;
  const booked = next !== null || paperRecent.length > 0;

  const owed = input.owed;
  const owes =
    owed && owed.lateCents > 0
      ? (() => {
          const daysLate = owed.oldestLateOn ? Math.max(1, isoDiff(today, owed.oldestLateOn)) : 1;
          return { cents: owed.lateCents, daysLate, text: `Owes ${wholeDollars(owed.lateCents)} · ${plural(daysLate, "day", "days")} late` };
        })()
      : null;
  const owedOpen = owed ? owed.billedCents - owed.receivedCents > 0 : false;

  // The latest meeting has passed and nobody said how it went.
  const meetingDue =
    status === "MEETING_SET" &&
    input.lastMeeting !== null &&
    !input.lastMeeting.marked &&
    input.lastMeeting.at.getTime() <= now.getTime() &&
    !(next && next.kind === "meeting");

  // Step 1: the state.
  let state: HealthState;
  if (status === "WON") state = "WON";
  else if (CLOSED_LABELS[status]) state = "CLOSED";
  else if (hasConnect || REACHED_STATUSES.has(status)) state = "REACHED";
  else if (!hasTouch && status === "NOT_ACTIONED") state = "NEW";
  else state = "TRYING";

  let tone: HealthTone = "none";
  let word: HealthWordValue;
  let score: number | null = null;
  let band: HealthBand | null = null;
  let parts: LeadHealth["parts"] = null;
  let breakdown: string | null = null;
  let stalled = false;
  let park = false;
  let reason = "";
  let reasonKey: ReasonKey;

  if (state === "REACHED") {
    // Step 2: the score.
    const recent = recentPoints(lastTouchDays, Q);
    const talk = talkPoints(lastTalkDays, Q, input.triesSinceTalk);
    const nextPts = booked ? (late ? 15 : 30) : 0;
    const drag = paperDrag.length > 0 ? 15 : 0;
    score = Math.max(0, Math.min(100, recent + talk + nextPts - drag));
    band = bandOf(score);
    tone = BAND_TONE[band];
    word = BAND_WORD[band];
    parts = { recent, talk, next: nextPts, drag };
    breakdown = `Recent ${recent} · Talk ${talk} · Next step ${nextPts}${drag ? ` − Drag ${drag}` : ""} = ${score}`;

    // Step 3: one reason sentence, the first that applies.
    if (owes) {
      reason = owes.text;
      reasonKey = "owes";
    } else if (late) {
      reason = `Follow-up ${plural(lateDays, "day", "days")} late`;
      reasonKey = "late";
    } else if (meetingDue && input.lastMeeting) {
      reason = `Did the ${shortDay(zoneDay(input.lastMeeting.at, tz))} meeting happen?`;
      reasonKey = "meeting";
    } else if (paperDrag.length > 0) {
      const paper = paperDrag[0];
      const out = daysAgo(paper.sentAt) ?? 0;
      reason = paper.kind === "contract" ? `Contract out ${out} days, not signed` : `Quote out ${out} days, no answer`;
      reasonKey = "paperwork";
    } else if (!booked && (lastTouchDays === null || lastTouchDays > Q)) {
      reason = lastTouchDays === null ? "Quiet · nothing booked" : `Quiet ${lastTouchDays} days · nothing booked`;
      reasonKey = "quiet";
    } else if (input.triesSinceTalk >= 5) {
      reason = `${input.triesSinceTalk} tries since you last talked`;
      reasonKey = "tries";
    } else {
      const head = lastTalkDays === null ? null : `Talked ${ago(lastTalkDays)}`;
      const paper = paperRecent[0];
      const tail = nextText ?? (paper ? `${paper.kind} out ${plural(daysAgo(paper.sentAt) ?? 0, "day", "days")}` : null);
      reason = head ? (tail ? `${head} · ${tail}` : head) : tail ? `Next: ${tail}` : "Nothing booked yet";
      reasonKey = "talked";
    }
  } else if (state === "TRYING") {
    word = "Trying";
    // Once a try is booked (parking writes "Try again · Name" 30 days out,
    // logActivity next=park), the offer stops until that day passes.
    park = input.tries >= Math.max(1, ctx.parkAfterTries || 6) && next === null;
    stalled = late !== null || (!booked && lastTouchDays !== null && lastTouchDays > Q);
    tone = stalled ? "warn" : "none";
    if (owes) {
      reason = owes.text;
      reasonKey = "owes";
    } else if (late) {
      reason = `Follow-up ${plural(lateDays, "day", "days")} late`;
      reasonKey = "late";
    } else if (park) {
      reason = `${input.tries} tries, never reached — try a text or someone else${input.companyName ? ` at ${input.companyName}` : ""}`;
      reasonKey = "park";
    } else if (stalled && lastTouchDays !== null) {
      reason =
        input.tries <= 1
          ? `${plural(Math.max(1, input.tries), "try", "tries")}, ${lastTouchDays} days ago — try again`
          : `${input.tries} tries, last one ${lastTouchDays} days ago — try again`;
      reasonKey = "stalled";
    } else if (input.tries === 0) {
      reason = nextText ? `No tries logged yet · ${nextText}` : "No tries logged yet";
      reasonKey = "trying";
    } else {
      const lastDay = input.lastTouchAt ? pastDay(zoneDay(input.lastTouchAt, tz), today) : null;
      const tail = next ? `next try ${aheadDay(next.on, today)}` : lastDay ? `last ${lastDay}` : null;
      reason = `Tried ${input.tries}×${tail ? ` · ${tail}` : ""}`;
      reasonKey = "trying";
    }
  } else if (state === "NEW") {
    word = "New";
    if (late) {
      reason = `Follow-up ${plural(lateDays, "day", "days")} late`;
      reasonKey = "late";
    } else {
      reason = nextText ? `Not tried yet · ${nextText}` : "Not tried yet";
      reasonKey = "new";
    }
  } else if (state === "WON") {
    word = "Won";
    tone = owes ? "risk" : "good";
    if (owes) {
      reason = owes.text;
      reasonKey = "owes";
    } else if (owed && owed.billedCents > 0) {
      reason =
        owed.receivedCents >= owed.billedCents
          ? "Won · paid in full"
          : `Won · ${wholeDollars(owed.billedCents - owed.receivedCents)} still to collect`;
      reasonKey = "won";
    } else {
      reason = "Won";
      reasonKey = "won";
    }
  } else {
    word = "Closed";
    const label = CLOSED_LABELS[status] ?? "Closed";
    let why: string | null = null;
    for (const change of input.changes) if (change.to === status && change.reason) why = reasonWords(change.reason);
    if (owes) {
      reason = owes.text;
      reasonKey = "owes";
    } else {
      reason = why ? `${label.charAt(0)}${label.slice(1).toLowerCase()} · ${why}` : label;
      reasonKey = "closed";
    }
  }

  const meter = buildMeter(input, ctx, { hasTouch, hasConnect, meetingDue, nextText, owedOpen });

  // The caption: counts that are zero draw nothing.
  const countBits: string[] = [];
  if (input.tries > 0) countBits.push(plural(input.tries, "try", "tries"));
  if (input.talks > 0) countBits.push(plural(input.talks, "talk", "talks"));
  else if (state === "TRYING" && input.tries > 0) countBits.push("no talks yet");
  if (input.meetings > 0) countBits.push(plural(input.meetings, "meeting", "meetings"));
  let caption: string;
  let miniCaption: string;
  if (state === "NEW") {
    caption = input.createdAt ? `New lead · added ${shortDay(zoneDay(input.createdAt, tz))}` : "New lead";
    miniCaption = "Not tried yet";
  } else {
    caption = [...countBits, lastTouchDays !== null ? `last touch ${shortAgo(lastTouchDays)}` : null].filter(Boolean).join(" · ");
    const miniBits: string[] = [];
    if (input.tries > 0) miniBits.push(plural(input.tries, "try", "tries"));
    if (input.talks > 0) miniBits.push(plural(input.talks, "talk", "talks"));
    if (lastTouchDays !== null) miniBits.push(shortAgo(lastTouchDays));
    miniCaption = miniBits.join(" · ");
    if (!caption) caption = word;
    if (!miniCaption) miniCaption = word;
  }

  const collected =
    state === "WON" && owed && owed.billedCents > 0
      ? `Collected ${wholeDollars(owed.receivedCents)} of ${wholeDollars(owed.billedCents)}`
      : null;

  const mark = HEALTH_MARKS[word];
  return {
    state,
    tone,
    word,
    mark,
    score,
    band,
    parts,
    breakdown,
    reason,
    reasonKey: reasonKey!,
    stalled,
    park,
    caption,
    miniCaption,
    counts: {
      tries: input.tries,
      talks: input.talks,
      meetings: input.meetings,
      byType: input.byType ?? null,
      lastTouchDays,
      lastTouchBy: input.lastTouchBy ?? null,
    },
    nextText,
    owes,
    collected,
    meter,
    label: meterLabel(meter, word, reason),
  };
}

// The lists' Pulse caption: "4 tries · 1 talk · 6d", plus who touched
// last when it isn't the record's rep ("6d · Priya"), so the "who" of the
// old Last Contacted By column stays on by default.
export function pulseCaption(health: Pick<LeadHealth, "miniCaption" | "counts">, repId: string | null | undefined) {
  const by = health.counts.lastTouchBy;
  if (!by || !by.name || by.id === repId) return health.miniCaption;
  return `${health.miniCaption} · ${by.name.trim().split(/\s+/)[0]}`;
}

/* -------------------------------- Roll-ups -------------------------------- */

// How warm, for picking a company's warmest person: Won, then Reached by
// score, then Trying (moving before stalled), New, Closed.
export function warmth(health: Pick<LeadHealth, "state" | "score" | "stalled">) {
  switch (health.state) {
    case "WON":
      return 400;
    case "REACHED":
      return 200 + (health.score ?? 0);
    case "TRYING":
      return health.stalled ? 110 : 120;
    case "NEW":
      return 100;
    default:
      return 0;
  }
}

export type CompanyHealth = LeadHealth & {
  reached: number;
  people: number;
  // "2 of 7 reached".
  reachedText: string;
  // Whose health the company is wearing.
  warmestId: string | null;
};

// A company wears its warmest person's health, its furthest person's
// meter, its own company-wide counts and "n of m reached". Money the
// company owes late comes first in the reason, and turns a Won company
// red. With nobody on it, `own` (the company's own touches) stands.
export function rollUpCompany(
  own: LeadHealth,
  people: { id: string; health: LeadHealth }[],
  extra: { reached: number; people: number },
): CompanyHealth {
  const reachedText = `${extra.reached} of ${extra.people} reached`;
  if (people.length === 0) return { ...own, reached: extra.reached, people: extra.people, reachedText, warmestId: null };
  let warmest = people[0];
  let furthest = people[0];
  for (const person of people) {
    if (warmth(person.health) > warmth(warmest.health)) warmest = person;
    if (meterReach(person.health.meter) > meterReach(furthest.health.meter)) furthest = person;
  }
  const meter = meterReach(own.meter) > meterReach(furthest.health.meter) ? own.meter : furthest.health.meter;
  const health = warmest.health;
  let reason = health.reason;
  let reasonKey = health.reasonKey;
  let tone = health.tone;
  let owes = health.owes;
  if (own.owes) {
    reason = own.owes.text;
    reasonKey = "owes";
    owes = own.owes;
    if (health.state === "WON") tone = "risk";
  }
  return {
    ...health,
    tone,
    reason,
    reasonKey,
    owes,
    collected: own.collected ?? health.collected,
    caption: own.caption,
    miniCaption: own.miniCaption,
    counts: own.counts,
    meter,
    label: meterLabel(meter, health.word, reason),
    reached: extra.reached,
    people: extra.people,
    reachedText,
    warmestId: warmest.id,
  };
}

// How far a meter has got, Won highest; a closed one counts where it
// stopped, below any open one at the same step.
function meterReach(meter: MeterState) {
  if (meter.closed) return meter.closed.at - 0.5;
  return meter.step;
}
