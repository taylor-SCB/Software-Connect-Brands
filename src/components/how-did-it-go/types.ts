import type { ActivityOutcomeValue, ActivityTypeValue, StatusReasonValue } from "@/lib/constants";
import type { NextStep } from "@/lib/outcomes";

// What the "How did it go?" sheet reads when it opens (logContext): who
// it is about, whether to offer parking, and the booked meeting waiting
// to be marked Held / No-show, if there is one.
export type LogContext = {
  // Today on the workspace's calendar.
  today: string;
  contactId: string | null;
  companyId: string | null;
  // The person, or the company on a company page.
  name: string;
  firstName: string;
  companyName: string | null;
  // Six tries (the workspace's parkAfterTries) and never reached: offer
  // "Try again in 30 days" first.
  park: boolean;
  tries: number;
  parkAfterTries: number;
  // The meeting a Meeting outcome answers (src/lib/meeting-rule.ts
  // toAnswer): the latest one that has come and nobody marked, else the
  // next one ahead, else the latest no-show with nothing booked since.
  meeting: { id: string; eventId: string | null; on: string; time: string | null; ahead: boolean; noShow?: boolean } | null;
};

// One save the sheet made, for "Saved · Undo" and the next step.
export type SavedLog = {
  batchId: string;
  // "Left voicemail", "Held · Meeting Completed"
  words: string;
  type: ActivityTypeValue;
  outcome: ActivityOutcomeValue | null;
  // The chip that was tapped (Busy, Not interested, Meeting booked …).
  chip: string | null;
  opportunityId: string | null;
  // The note as it was saved, so a later edit is only sent when changed.
  note: string;
  at: number;
};

// The step after a save, sent in one call (afterLog).
export type AfterLogInput = {
  batchId: string;
  note?: string | null;
  mark?: "INTERESTED" | "NOT_INTERESTED" | null;
  reason?: StatusReasonValue | null;
  next?: NextStep | null;
};

export type AfterLogResult = { success?: string; error?: string; opportunityId?: string | null; words?: string[] };
