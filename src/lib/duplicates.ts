import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// The duplicate finder (Nov 10, 2026, Taylor): likely duplicates grouped
// by one thing they share, a page of groups at a time, each group handed
// to the existing Merge flow with its records pre-picked.
//
// Contacts: the same email (either of their two, ignoring case), the same
// phone (phone, second phone or mobile; digits only, the last 10, and only
// numbers with at least 10), or the same name at the same company.
// Companies: the same name ignoring case, spaces and punctuation, the same
// website domain (no http, no www), or the same phone.
//
// Each is one grouped statement over the workspace's rows. The keys are
// worked out in SQL so the grouping never leaves the database; at 200,000
// contacts a page of groups is well inside the lists' 2-second budget.

export const DUPLICATE_MODES = {
  contacts: ["email", "phone", "name"],
  companies: ["name", "domain", "phone"],
} as const;
export type DuplicateKind = keyof typeof DUPLICATE_MODES;
export type DuplicateMode = "email" | "phone" | "name" | "domain";

export const DUPLICATE_LABELS: Record<DuplicateKind, Partial<Record<DuplicateMode, string>>> = {
  contacts: { email: "Same email", phone: "Same phone", name: "Same name at the same company" },
  companies: { name: "Same name", domain: "Same website", phone: "Same phone" },
};

export const GROUPS_PER_PAGE = 25;
// A group lists at most this many of its records (and the Merge flow takes
// five at a time); the count says how many there are in all.
const SHOWN_PER_GROUP = 10;

export type DuplicateGroup = { key: string; count: number; ids: string[] };

function keysSql(kind: DuplicateKind, mode: DuplicateMode, organizationId: string): Prisma.Sql {
  if (kind === "contacts") {
    if (mode === "email") {
      return Prisma.sql`
        SELECT c.id, c."createdAt", lower(btrim(e)) AS key
          FROM "Contact" c, unnest(ARRAY[c.email, c.email2]) e
         WHERE c."organizationId" = ${organizationId} AND btrim(coalesce(e, '')) <> ''`;
    }
    if (mode === "phone") {
      return Prisma.sql`
        SELECT id, "createdAt", key FROM (
          SELECT c.id, c."createdAt", right(regexp_replace(p, '\\D', '', 'g'), 10) AS key
            FROM "Contact" c, unnest(ARRAY[c.phone, c.phone2, c.mobile]) p
           WHERE c."organizationId" = ${organizationId} AND p IS NOT NULL
        ) t WHERE length(key) = 10`;
    }
    return Prisma.sql`
      SELECT c.id, c."createdAt", c."companyId" || '|' || lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) AS key
        FROM "Contact" c
       WHERE c."organizationId" = ${organizationId} AND c."companyId" IS NOT NULL`;
  }
  if (mode === "domain") {
    return Prisma.sql`
      SELECT id, "createdAt", key FROM (
        SELECT c.id, c."createdAt",
               lower(regexp_replace(btrim(c.website), '^([a-z]+://)?(www\\.)?([^/:?#]+).*$', '\\3', 'i')) AS key
          FROM "Company" c
         WHERE c."organizationId" = ${organizationId} AND btrim(coalesce(c.website, '')) <> ''
      ) t WHERE key LIKE '%.%'`;
  }
  if (mode === "phone") {
    return Prisma.sql`
      SELECT id, "createdAt", key FROM (
        SELECT c.id, c."createdAt", right(regexp_replace(c.phone, '\\D', '', 'g'), 10) AS key
          FROM "Company" c
         WHERE c."organizationId" = ${organizationId} AND c.phone IS NOT NULL
      ) t WHERE length(key) = 10`;
  }
  return Prisma.sql`
    SELECT id, "createdAt", key FROM (
      SELECT c.id, c."createdAt", lower(regexp_replace(c.name, '[^[:alnum:]]+', '', 'g')) AS key
        FROM "Company" c
       WHERE c."organizationId" = ${organizationId}
    ) t WHERE key <> ''`;
}

export async function findDuplicateGroups(
  organizationId: string,
  kind: DuplicateKind,
  mode: DuplicateMode,
  page: number,
): Promise<{ groups: DuplicateGroup[]; total: number }> {
  const pageOf = (n: number) =>
    prisma.$queryRaw<{ key: string; n: number; ids: string[]; total: number }[]>`
      WITH k AS (${keysSql(kind, mode, organizationId)}),
      g AS (
        SELECT key, count(DISTINCT id)::int AS n,
               (array_agg(id ORDER BY "createdAt", id))[1:${SHOWN_PER_GROUP * 3}] AS ids
          FROM k GROUP BY key HAVING count(DISTINCT id) > 1
      )
      SELECT key, n, ids, (count(*) OVER ())::int AS total
        FROM g ORDER BY n DESC, key
       LIMIT ${GROUPS_PER_PAGE} OFFSET ${(Math.max(1, n) - 1) * GROUPS_PER_PAGE}`;
  let rows = await pageOf(page);
  // Past the last page (audit fix, Nov 10, 2026): merging the only group
  // on the final page left an empty page, and the count came from that
  // page, so the finder said "0 groups" while page 1 still had 25. Show
  // the last page there is instead.
  if (rows.length === 0 && page > 1) {
    const first = await pageOf(1);
    const total = first[0]?.total ?? 0;
    const last = Math.max(1, Math.ceil(total / GROUPS_PER_PAGE));
    rows = last === 1 ? first : await pageOf(last);
  }
  return {
    total: rows[0]?.total ?? 0,
    // A record listed twice under one key (two numbers that match each
    // other) is shown once.
    groups: rows.map((row) => ({ key: row.key, count: row.n, ids: Array.from(new Set(row.ids)).slice(0, SHOWN_PER_GROUP) })),
  };
}
