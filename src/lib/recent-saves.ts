import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// The latest saves (audit fix, Nov 12, 2026), for My day's Done today and
// Overview's Recent activity. One touch logged on many people is one row
// per person sharing a batchId (up to 500), so "the newest 80 rows, then
// fold by batch" let one big save fill the card and push every earlier
// save off it, with a wrong "+ 79". This picks the saves first and then
// reads at most three rows of each, so each save is one line with its true
// head count. Real touches only (no marketing), dated `to` or earlier.

const SCAN = 5000; // newest rows read to find the saves: 10+ saves of the 500 a save can hold

export type RecentSave = {
  key: string;
  // People on the save (distinct), and the first three of them.
  peopleCount: number;
  people: { id: string; name: string }[];
  first: {
    id: string;
    type: string;
    outcome: string | null;
    body: string;
    occurredAt: Date;
    contactId: string | null;
    companyId: string | null;
    contact: { id: string; name: string; company: { name: string } | null } | null;
    company: { id: string; name: string } | null;
    user: { name: string } | null;
  };
  company: { id: string | null; name: string } | null;
};

export async function recentSaves(
  organizationId: string,
  options: { userId?: string | null; from?: Date; to: Date; limit: number },
): Promise<RecentSave[]> {
  const who = options.userId ? Prisma.sql`AND a."userId" = ${options.userId}` : Prisma.empty;
  const since = options.from ? Prisma.sql`AND a."occurredAt" >= ${options.from}` : Prisma.empty;
  const keys = await prisma.$queryRaw<{ k: string; at: Date }[]>`
    SELECT k, MAX(at) AS at FROM (
      SELECT COALESCE(a."batchId", a.id) AS k, a."occurredAt" AS at
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false
         AND a."occurredAt" <= ${options.to} ${since} ${who}
       ORDER BY a."occurredAt" DESC
       LIMIT ${SCAN}
    ) newest
    GROUP BY k ORDER BY MAX(at) DESC LIMIT ${options.limit}`;
  if (!keys.length) return [];
  const list = keys.map((row) => row.k);
  const [heads, counts] = await Promise.all([
    prisma.$queryRaw<{ id: string; k: string }[]>`
      SELECT id, k FROM (
        SELECT a.id, COALESCE(a."batchId", a.id) AS k,
               row_number() OVER (PARTITION BY COALESCE(a."batchId", a.id) ORDER BY a."occurredAt" DESC, a.id) AS rn
          FROM "Activity" a
         WHERE a."organizationId" = ${organizationId} AND (a."batchId" = ANY(${list}) OR a.id = ANY(${list}))
      ) t WHERE rn <= 3`,
    prisma.$queryRaw<{ k: string; people: number }[]>`
      SELECT COALESCE(a."batchId", a.id) AS k, COUNT(DISTINCT a."contactId")::int AS people
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND (a."batchId" = ANY(${list}) OR a.id = ANY(${list}))
       GROUP BY 1`,
  ]);
  const rows = await prisma.activity.findMany({
    where: { organizationId, id: { in: heads.map((row) => row.id) } },
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      batchId: true,
      type: true,
      outcome: true,
      body: true,
      occurredAt: true,
      contactId: true,
      companyId: true,
      contact: { select: { id: true, name: true, company: { select: { name: true } } } },
      company: { select: { id: true, name: true } },
      user: { select: { name: true } },
    },
  });
  const countOf = new Map(counts.map((row) => [row.k, Number(row.people)]));
  const saves: RecentSave[] = [];
  for (const key of list) {
    const mine = rows.filter((row) => (row.batchId ?? row.id) === key);
    if (!mine.length) continue;
    const first = mine[0];
    const people: { id: string; name: string }[] = [];
    for (const row of mine) if (row.contact && !people.some((p) => p.id === row.contact!.id)) people.push({ id: row.contact.id, name: row.contact.name });
    const company = first.company ? { id: first.company.id, name: first.company.name } : (mine.find((row) => row.contact?.company)?.contact?.company ? { id: null, name: mine.find((row) => row.contact?.company)!.contact!.company!.name } : null);
    saves.push({ key, peopleCount: countOf.get(key) ?? people.length, people, first, company });
  }
  return saves;
}
