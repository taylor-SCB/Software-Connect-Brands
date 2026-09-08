// Rules shared by the ratesheet tiles, the partner page and the respond
// action, so "is this still open" has one answer everywhere.

export const DAY_MS = 24 * 60 * 60 * 1000;

// A date input gives "2026-09-30"; parse as UTC noon (the same convention
// as Quote.validUntil) so the displayed day can't drift for viewers
// behind UTC.
export function dateInputToUtcNoon(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// yyyy-mm-dd for <input type="date">.
export function toDateInput(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "";
}

// A ratesheet is usable through its expiry day everywhere in the US: it
// expires at noon UTC on the following day, which is never earlier than
// local midnight in any supported zone (Hawaii's midnight is 10:00Z) and
// at worst gives a few hours of grace the morning after.
export function ratesheetExpired(expiresOn: Date | null, now = new Date()) {
  return !!expiresOn && now.getTime() > expiresOn.getTime() + DAY_MS;
}

export type RatesheetState = "ACTIVE" | "INACTIVE" | "EXPIRED";

export function ratesheetState(
  ratesheet: { active: boolean; expiresOn: Date | null },
  now = new Date(),
): RatesheetState {
  if (!ratesheet.active) return "INACTIVE";
  if (ratesheetExpired(ratesheet.expiresOn, now)) return "EXPIRED";
  return "ACTIVE";
}

export type InviteState = "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED";

// An invite that was answered keeps its answer. One still waiting goes
// dark when its own window closes or when the sheet does.
export function inviteState(
  invite: { status: string; respondBy: Date | null },
  ratesheet: { active: boolean; expiresOn: Date | null },
  now = new Date(),
): InviteState {
  if (invite.status === "APPROVED" || invite.status === "DECLINED") return invite.status;
  if (ratesheetState(ratesheet, now) !== "ACTIVE") return "EXPIRED";
  if (invite.respondBy && now.getTime() > invite.respondBy.getTime()) return "EXPIRED";
  return "PENDING";
}

export function respondByFor(sentAt: Date, respondWithinDays: number | null) {
  if (!respondWithinDays) return null;
  return new Date(sentAt.getTime() + respondWithinDays * DAY_MS);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
