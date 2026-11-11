import { z } from "zod";
import {
  ACTIVITY_LABELS,
  ACTIVITY_OUTCOMES,
  ACTIVITY_OUTCOME_LABELS,
  ACTIVITY_TYPES,
  CONTACT_STATUS_LABELS,
  NEXT_STEP_KINDS,
  OUTCOMES_BY_TYPE,
  STATUS_REASONS,
  STATUS_REASON_LABELS,
  type ActivityOutcomeValue,
  type ActivityTypeValue,
  type StatusReasonValue,
} from "@/lib/constants";

// "How did it go?" (BDR redesign, Nov 11, 2026): the outcome of a touch,
// the status a person can mark in the same tap (Interested / Not
// interested with its reason), and the next step. Shared by the contact
// and company log (logActivity), the calendar's Done box
// (completeEventWithLog) and the Book meeting sheet (bookMeeting), so all
// three read the same fields the same way. No database here: safe in the
// browser too.

export const outcomeSchema = z.enum(ACTIVITY_OUTCOMES);
export const reasonSchema = z.enum(STATUS_REASONS);
// The status a log can set by hand in the same save.
export const LOG_MARKS = ["INTERESTED", "NOT_INTERESTED"] as const;
export type LogMark = (typeof LOG_MARKS)[number];
export const markSchema = z.enum(LOG_MARKS);

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day");

// One next step. `follow`: a follow-up of `type` (a call unless said) on
// `on`. `book`: "Try to book a meeting" on `on` (three days on when
// empty) — a reminder that moves no status (decision 5). `park`: "Try
// again in 30 days" (decision 12), no status. `meeting`: book the meeting
// now — `on` (today or later), `time`, who else (`withContactIds`),
// `where`, `note`, and which tile it joins (`opportunity`: "auto", "new"
// or an open opportunity's id).
export const nextStepSchema = z.object({
  kind: z.enum(NEXT_STEP_KINDS),
  on: z.union([isoDay, z.literal("")]).optional(),
  time: z.string().max(8).optional(),
  type: z.enum(ACTIVITY_TYPES).optional(),
  withContactIds: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  where: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  opportunity: z.string().trim().max(100).optional(),
});
export type NextStep = z.infer<typeof nextStepSchema>;

// The next step out of a form: next, nextOn, nextTime, nextType, nextWith
// (repeatable), nextWhere, nextNote, opportunity. Nothing when `next` is
// empty or missing (what today's forms send).
export function readNextStep(formData: FormData): unknown {
  const kind = formData.get("next");
  if (typeof kind !== "string" || !kind) return undefined;
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };
  return {
    kind,
    on: text("nextOn"),
    time: text("nextTime"),
    type: text("nextType") || undefined,
    withContactIds: formData.getAll("nextWith").filter((value): value is string => typeof value === "string" && value !== ""),
    where: text("nextWhere"),
    note: text("nextNote"),
    opportunity: text("opportunity"),
  };
}

// Why an outcome doesn't fit the kind of touch, in words, or null.
export function outcomeProblem(type: ActivityTypeValue, outcome: ActivityOutcomeValue | null | undefined) {
  if (!outcome) return null;
  if (OUTCOMES_BY_TYPE[type].includes(outcome)) return null;
  return `“${ACTIVITY_OUTCOME_LABELS[outcome]}” isn't something a ${ACTIVITY_LABELS[type].toLowerCase()} can be`;
}

// The words a chip leaves as the note when nothing was typed: "Left
// voicemail", "Talked · Not Interested (Price)", "They replied · Meeting
// booked".
export function outcomeNote(input: {
  outcome: ActivityOutcomeValue | null | undefined;
  mark?: LogMark | null;
  reason?: StatusReasonValue | null;
  booked?: boolean;
}) {
  const parts: string[] = [];
  if (input.outcome) parts.push(ACTIVITY_OUTCOME_LABELS[input.outcome]);
  if (input.mark) {
    const label = input.mark === "NOT_INTERESTED" ? "Not interested" : CONTACT_STATUS_LABELS[input.mark];
    parts.push(input.reason ? `${label} (${STATUS_REASON_LABELS[input.reason]})` : label);
  }
  if (input.booked) parts.push("Meeting booked");
  return parts.join(" · ");
}

// "Meeting booked" on a call is a talk, on a text or email a reply.
export function connectOutcomeFor(type: ActivityTypeValue): ActivityOutcomeValue {
  return type === "PHONE_CALL" ? "TALKED" : type === "MEETING" ? "HELD" : "REPLIED";
}
