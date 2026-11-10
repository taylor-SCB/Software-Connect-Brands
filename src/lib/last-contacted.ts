import { prisma } from "@/lib/prisma";

export type LastContact = { at: Date; by: string };

// "Last Contacted By" on the Contacts and Companies lists: the most recent
// call, email, text or meeting anybody logged, and who logged it. Only
// touches that have happened count — a call dated ahead is on the
// calendar, not in anyone's history. Marketing sends are not a touch
// (Taylor, Nov 10, 2026): they have their own Marketing column.
//
// Asked for the rows on one page only, so it is the same speed at fifty
// contacts or two hundred thousand.
export async function lastContactedContacts(organizationId: string, contactIds: string[]) {
  if (contactIds.length === 0) return new Map<string, LastContact>();
  const rows = await prisma.$queryRaw<{ key: string; at: Date; by: string }[]>`
    SELECT DISTINCT ON (a."contactId") a."contactId" AS key, a."occurredAt" AS at, u.name AS by
      FROM "Activity" a
      JOIN "User" u ON u.id = a."userId"
     WHERE a."organizationId" = ${organizationId}
       AND a."contactId" = ANY(${contactIds})
       AND a."occurredAt" <= now()
       AND a.marketing = false
     ORDER BY a."contactId", a."occurredAt" DESC, a."createdAt" DESC
  `;
  return toMap(rows);
}

// A company counts as contacted when anyone at it was, or when the touch
// was logged on the company itself.
export async function lastContactedCompanies(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return new Map<string, LastContact>();
  const rows = await prisma.$queryRaw<{ key: string; at: Date; by: string }[]>`
    SELECT DISTINCT ON (t.key) t.key, t.at, t.by
      FROM (
        SELECT a."companyId" AS key, a."occurredAt" AS at, a."createdAt" AS made, u.name AS by
          FROM "Activity" a
          JOIN "User" u ON u.id = a."userId"
         WHERE a."organizationId" = ${organizationId}
           AND a."companyId" = ANY(${companyIds})
           AND a."occurredAt" <= now()
           AND a.marketing = false
        UNION ALL
        SELECT c."companyId" AS key, a."occurredAt" AS at, a."createdAt" AS made, u.name AS by
          FROM "Activity" a
          JOIN "Contact" c ON c.id = a."contactId"
          JOIN "User" u ON u.id = a."userId"
         WHERE a."organizationId" = ${organizationId}
           AND c."companyId" = ANY(${companyIds})
           AND a."occurredAt" <= now()
           AND a.marketing = false
      ) t
     ORDER BY t.key, t.at DESC, t.made DESC
  `;
  return toMap(rows);
}

function toMap(rows: { key: string; at: Date; by: string }[]) {
  return new Map(rows.map((row) => [row.key, { at: row.at, by: row.by }]));
}

// The Marketing column (Nov 10, 2026): how many marketing emails went to
// each person on the page, and the last one. For a company, its people's.
export type MarketingTally = { count: number; last: Date };

export async function marketingContacts(organizationId: string, contactIds: string[]) {
  if (contactIds.length === 0) return new Map<string, MarketingTally>();
  const rows = await prisma.$queryRaw<{ key: string; n: number; last: Date }[]>`
    SELECT a."contactId" AS key, count(*)::int AS n, max(a."occurredAt") AS last
      FROM "Activity" a
     WHERE a."organizationId" = ${organizationId}
       AND a."contactId" = ANY(${contactIds})
       AND a.marketing = true
     GROUP BY a."contactId"`;
  return new Map(rows.map((row) => [row.key, { count: row.n, last: row.last }]));
}

export async function marketingCompanies(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return new Map<string, MarketingTally>();
  const rows = await prisma.$queryRaw<{ key: string; n: number; last: Date }[]>`
    SELECT c."companyId" AS key, count(*)::int AS n, max(a."occurredAt") AS last
      FROM "Activity" a
      JOIN "Contact" c ON c.id = a."contactId"
     WHERE a."organizationId" = ${organizationId}
       AND c."companyId" = ANY(${companyIds})
       AND a.marketing = true
     GROUP BY c."companyId"`;
  return new Map(rows.map((row) => [row.key, { count: row.n, last: row.last }]));
}
