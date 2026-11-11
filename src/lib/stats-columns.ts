// The Stats leaderboard's columns (Nov 11, 2026). Rep, Tries, Talks,
// Connect rate, Meetings booked, Held and Won $ show by default; the rest
// are one tap away under Columns, and each person's pick is remembered on
// User.uiPrefs stats.columns (saveUiPref; an earlier top-level
// statsColumns is read as a fallback). Browser-safe: the page and the
// menu both read this one list.

export const LEADERBOARD_COLUMNS = [
  { key: "tries", label: "Tries", format: "count", hint: "Calls, texts, emails and meetings logged, each save once" },
  { key: "talks", label: "Talks", format: "count", hint: "Tries that connected: talked, they replied, or a meeting held" },
  { key: "connectRate", label: "Connect rate", format: "rate", hint: "Talks ÷ tries" },
  { key: "booked", label: "Meetings booked", format: "count", hint: "Meetings booked in the period, credited to who booked them" },
  { key: "held", label: "Held", format: "count", hint: "Meetings that came due in the period and were held, credited to who booked them" },
  { key: "wonCents", label: "Won $", format: "money", hint: "Deals won in the period, credited to the deal's rep" },
  { key: "showRate", label: "Show rate", format: "rate", hint: "Held ÷ booked meetings that came due" },
  { key: "calls", label: "Calls", format: "count" },
  { key: "texts", label: "Texts", format: "count" },
  { key: "emails", label: "Emails", format: "count" },
  { key: "meetings", label: "Meetings logged", format: "count" },
  { key: "attempted", label: "Attempted", format: "count", hint: "People who reached Attempted" },
  { key: "connected", label: "Connected", format: "count", hint: "People who reached Connected" },
  { key: "meetingSet", label: "Mtg set", format: "count", hint: "People who reached Meeting Set" },
  { key: "meetingCompleted", label: "Mtg completed", format: "count", hint: "People who reached Meeting Completed" },
  { key: "quotes", label: "Quotes", format: "count" },
  { key: "contracts", label: "Contracts", format: "count" },
  { key: "won", label: "Won", format: "count" },
  { key: "closeRate", label: "Close rate", format: "rate", hint: "Won ÷ (won + lost)" },
] as const;

export type LeaderboardColumnKey = (typeof LEADERBOARD_COLUMNS)[number]["key"];
export type LeaderboardFormat = (typeof LEADERBOARD_COLUMNS)[number]["format"];

export const DEFAULT_LEADERBOARD_COLUMNS: LeaderboardColumnKey[] = ["tries", "talks", "connectRate", "booked", "held", "wonCents"];

const KEYS = new Set<string>(LEADERBOARD_COLUMNS.map((column) => column.key));

// What uiPrefs holds, cleaned: known keys, in the list's own order, at
// least one. Anything else reads as the default.
export function readLeaderboardColumns(value: unknown): LeaderboardColumnKey[] {
  if (!Array.isArray(value)) return DEFAULT_LEADERBOARD_COLUMNS;
  const picked = new Set(value.filter((key): key is string => typeof key === "string" && KEYS.has(key)));
  const ordered = LEADERBOARD_COLUMNS.map((column) => column.key).filter((key) => picked.has(key));
  return ordered.length ? ordered : DEFAULT_LEADERBOARD_COLUMNS;
}

export type LeaderboardRow = {
  id: string;
  name: string;
  values: Record<LeaderboardColumnKey, number | null>;
};
