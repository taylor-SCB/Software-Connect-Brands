import { OUTCOMES_BY_TYPE, type ActivityOutcomeValue, type ActivityTypeValue } from "@/lib/constants";

// What "Fill it in from my words" may pick (AI release A, Nov 12, 2026),
// shared by the sheet and the server so both check the same lists. The
// chips are the sheet's own (how-did-it-go.tsx CALL, CALL_MORE, MESSAGE,
// MEETING); the next steps are every one nextChoices can offer after that
// chip — the sheet still drops one it isn't offering at that moment (no
// Book meeting without someone to book with, no 30-day rest before the
// try limit).

export type VoiceChip = { key: string; label: string; outcome: ActivityOutcomeValue | null; meaning: string };

const CALL: VoiceChip[] = [
  { key: "NO_ANSWER", label: "No answer", outcome: "NO_ANSWER", meaning: "rang out, nobody picked up" },
  { key: "VOICEMAIL", label: "Left voicemail", outcome: "VOICEMAIL", meaning: "left a voicemail" },
  { key: "TALKED", label: "Talked", outcome: "TALKED", meaning: "spoke with them" },
  { key: "BOOKED", label: "Meeting booked", outcome: "TALKED", meaning: "spoke and booked a meeting" },
  { key: "NOT_INTERESTED", label: "Not interested", outcome: "TALKED", meaning: "spoke and they said they aren't interested" },
  { key: "BUSY", label: "Busy", outcome: "NO_ANSWER", meaning: "line was busy" },
  { key: "GATEKEEPER", label: "Front desk", outcome: "GATEKEEPER", meaning: "only reached a receptionist or front desk" },
  { key: "BAD_NUMBER", label: "Wrong number", outcome: "BAD_NUMBER", meaning: "wrong or dead number" },
];
const MESSAGE: VoiceChip[] = [
  { key: "SENT", label: "Sent", outcome: "SENT", meaning: "sent it, no reply yet" },
  { key: "REPLIED", label: "They replied", outcome: "REPLIED", meaning: "they wrote back" },
  { key: "BOOKED", label: "Meeting booked", outcome: "REPLIED", meaning: "they wrote back and a meeting is booked" },
  { key: "NOT_INTERESTED", label: "Not interested", outcome: "REPLIED", meaning: "they wrote back that they aren't interested" },
];
const MEETING: VoiceChip[] = [
  { key: "HELD", label: "Held", outcome: "HELD", meaning: "the meeting happened" },
  { key: "NO_SHOW", label: "No-show", outcome: "NO_SHOW", meaning: "they didn't turn up" },
  { key: "RESCHEDULED", label: "Rescheduled", outcome: null, meaning: "the meeting moved to another day" },
];

export function voiceChips(type: ActivityTypeValue): VoiceChip[] {
  const list = type === "PHONE_CALL" ? CALL : type === "MEETING" ? MEETING : MESSAGE;
  // Only chips whose outcome is one this kind of touch can have.
  return list.filter((chip) => chip.outcome === null || (OUTCOMES_BY_TYPE[type] as readonly string[]).includes(chip.outcome));
}

export const VOICE_NEXT_LABELS: Record<string, string> = {
  follow: "Try again / follow up on a day",
  park: "Try again in 30 days",
  book: "Try to book a meeting (a reminder)",
  meeting: "Book a meeting on a day",
  quote: "Start a quote",
  lost: "Not moving forward",
  reschedule: "Reschedule the meeting",
};

const TRY_KEYS = ["NO_ANSWER", "VOICEMAIL", "BUSY", "GATEKEEPER", "BAD_NUMBER", "SENT"];

export function voiceNextSteps(chip: string | null): string[] {
  if (!chip) return [];
  if (chip === "TALKED" || chip === "REPLIED") return ["meeting", "book", "follow"];
  if (chip === "HELD") return ["quote", "meeting", "lost"];
  if (chip === "NO_SHOW") return ["reschedule", "follow"];
  if (TRY_KEYS.includes(chip)) return ["follow", "park", "book"];
  // Meeting booked and Rescheduled open the booking form, which takes the
  // day; Not interested has no next step but a reason.
  return [];
}

// Chips that open the booking form, where a said day becomes the booking's.
export function voiceBooks(chip: string | null) {
  return chip === "BOOKED" || chip === "RESCHEDULED";
}
