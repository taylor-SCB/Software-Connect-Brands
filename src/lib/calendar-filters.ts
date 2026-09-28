// Reading the calendar's filters out of the address bar. Kept apart from
// calendar-data.ts, which imports Prisma, so the toolbar (a client
// component) can share the same names without pulling the database in.

// The value that stands for "days on nobody's calendar" in ?users=.
export const UNASSIGNED_USER = "none";

export type CalendarLayoutValue = "calendar" | "log" | "both";

// "a,b,c" → ["a","b","c"], capped so a pasted address cannot turn into a
// thousand-id IN clause. Anything that is not a plain id is dropped.
export function readIds(value: string | string[] | undefined, max = 50): string[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !seen.has(id)) seen.add(id);
    if (seen.size >= max) break;
  }
  return Array.from(seen);
}

export function readLayout(value: string | string[] | undefined): CalendarLayoutValue {
  return value === "log" || value === "both" ? value : "calendar";
}
