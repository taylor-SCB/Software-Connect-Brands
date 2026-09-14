// The workspace's event-type list. Seeded the first time a form asks for
// it, the same lazy way industries and service types are, so a workspace
// that existed before the calendar gets the starting list without a data
// migration.

import { prisma } from "@/lib/prisma";
import { EVENT_TYPE_DEFAULTS } from "@/lib/constants";
import { cleanName } from "@/lib/industries";

export const MAX_EVENT_TYPE_OPTIONS = 100;

export async function getEventTypes(organizationId: string): Promise<string[]> {
  const load = () =>
    prisma.eventTypeOption.findMany({
      where: { organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { name: true },
    });

  let rows = await load();
  if (rows.length === 0) {
    // Two tabs can both try to seed; the unique index lets one win and
    // the other reads what it wrote.
    await prisma.eventTypeOption.createMany({
      data: EVENT_TYPE_DEFAULTS.map((name, position) => ({ organizationId, name, position })),
      skipDuplicates: true,
    });
    rows = await load();
  }
  return rows.map((row) => row.name);
}

// "+ Add new event type". Returns the name as stored, so the caller
// writes the workspace's spelling rather than whatever was typed.
export async function ensureEventType(organizationId: string, raw: string): Promise<string | null> {
  const name = cleanName(raw);
  if (!name) return null;

  const existing = await prisma.eventTypeOption.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { name: true },
  });
  if (existing) return existing.name;

  const count = await prisma.eventTypeOption.count({ where: { organizationId } });
  // Past the cap the name still saves on the event; it just stops being
  // offered in the list.
  if (count >= MAX_EVENT_TYPE_OPTIONS) return name;

  try {
    await prisma.eventTypeOption.create({ data: { organizationId, name, position: count } });
  } catch {
    // Someone else added the same one between the check and the write.
  }
  return name;
}
