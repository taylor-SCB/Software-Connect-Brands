// The workspace's service-type list: the kinds of work it sells. Seeded
// the first time a form asks for it, the same lazy way industries are,
// so a workspace that existed before this feature gets the same starting
// list without a data migration.

import { prisma } from "@/lib/prisma";
import { SERVICE_TYPE_DEFAULTS } from "@/lib/constants";
import { cleanName } from "@/lib/industries";

export const MAX_SERVICE_TYPE_OPTIONS = 200;

export async function getServiceTypes(organizationId: string): Promise<string[]> {
  const load = () =>
    prisma.serviceTypeOption.findMany({
      where: { organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { name: true },
    });

  let rows = await load();
  if (rows.length === 0) {
    // Two tabs can both try to seed; the unique index lets one win and
    // the other reads what it wrote.
    await prisma.serviceTypeOption.createMany({
      data: SERVICE_TYPE_DEFAULTS.map((name, position) => ({ organizationId, name, position })),
      skipDuplicates: true,
    });
    rows = await load();
  }
  return rows.map((row) => row.name);
}

// "+ Add new service type". Returns the name as stored, so the caller
// writes the workspace's spelling rather than whatever was typed.
export async function ensureServiceType(organizationId: string, raw: string): Promise<string | null> {
  const name = cleanName(raw);
  if (!name) return null;

  const existing = await prisma.serviceTypeOption.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { name: true },
  });
  if (existing) return existing.name;

  const count = await prisma.serviceTypeOption.count({ where: { organizationId } });
  // Past the cap the name still saves on whatever is using it; it just
  // stops being offered in the list.
  if (count >= MAX_SERVICE_TYPE_OPTIONS) return name;

  try {
    await prisma.serviceTypeOption.create({ data: { organizationId, name, position: count } });
  } catch {
    // Someone else added the same one between the check and the write.
  }
  return name;
}
