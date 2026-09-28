// The workspace's event-type list. Seeded the first time a form asks for
// it, the same lazy way industries and service types are, so a workspace
// that existed before the calendar gets the starting list without a data
// migration.

import { prisma } from "@/lib/prisma";
import { EVENT_TYPE_DEFAULTS } from "@/lib/constants";
import { cleanName } from "@/lib/industries";

export const MAX_EVENT_TYPE_OPTIONS = 100;

function loadRows(organizationId: string) {
  return prisma.eventTypeOption.findMany({
    where: { organizationId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { name: true },
  });
}

// Whatever of the starting list a workspace does not have yet joins it.
// Not only on an empty list: a brand-new workspace's first touch of the
// calendar can be the app writing "Contract sent" for a contract that
// went out, which used to leave the list at that one name and no
// Install or Site walk to pick. Matched without regard to case so a
// workspace that typed "call" itself does not get a second "Call", and
// "Other" is kept last.
async function seedMissing(organizationId: string, rows: { name: string }[]) {
  const have = new Set(rows.map((row) => row.name.toLowerCase()));
  const missing = EVENT_TYPE_DEFAULTS.filter((name) => !have.has(name.toLowerCase()));
  if (missing.length === 0 || rows.length + missing.length > MAX_EVENT_TYPE_OPTIONS) return false;

  const other = rows.findIndex((row) => row.name === "Other");
  const at = other === -1 ? rows.length : other;
  // Two tabs can both try to seed; the unique index lets one win and
  // the other reads what it wrote.
  await prisma.eventTypeOption.createMany({
    data: missing.map((name, index) => ({ organizationId, name, position: at + index })),
    skipDuplicates: true,
  });
  if (other !== -1) {
    await prisma.eventTypeOption.updateMany({
      where: { organizationId, name: "Other" },
      data: { position: at + missing.length },
    });
  }
  return true;
}

export async function getEventTypes(organizationId: string): Promise<string[]> {
  let rows = await loadRows(organizationId);
  if (await seedMissing(organizationId, rows)) rows = await loadRows(organizationId);
  return rows.map((row) => row.name);
}

// "+ Add new event type". Returns the name as stored, so the caller
// writes the workspace's spelling rather than whatever was typed.
export async function ensureEventType(organizationId: string, raw: string): Promise<string | null> {
  const name = cleanName(raw);
  if (!name) return null;

  // The starting list goes in first, so the app writing a milestone on a
  // workspace nobody has opened the calendar in yet does not become the
  // whole list.
  await seedMissing(organizationId, await loadRows(organizationId));

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
