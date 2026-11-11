import { ACTIVITY_EVENT_TYPES } from "@/lib/constants";

// The workspace's event types with the sales ones first (round 2, Nov 11,
// 2026): "+ Event" opened from a lead's page lists Call, Meeting, Email,
// Text and the quote and contract milestones before Install and Site
// walk. The workspace's own spelling is kept, and nothing is dropped.
export function salesFirst(types: string[]): string[] {
  const sales: string[] = [];
  for (const name of ACTIVITY_EVENT_TYPES) {
    const match = types.find((type) => type.toLowerCase() === name.toLowerCase());
    if (match) sales.push(match);
  }
  const taken = new Set(sales);
  return [...sales, ...types.filter((type) => !taken.has(type))];
}
