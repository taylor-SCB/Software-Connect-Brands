import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { likeText } from "@/lib/list-query";

// "Looks like the same person" (AI release A, Nov 12, 2026; no AI): other
// contacts in the workspace that share an email with this one (either of
// their two, ignoring case), a phone (phone, second phone or mobile, the
// last 10 digits), or the same name at a different company. A pair
// someone marked "Not the same person" (DuplicateDismissal) is never
// suggested again, here or in Find duplicates.
//
// One statement per page view. Every match goes through an index first —
// the trigram indexes on email, email2 and name, and the digits index
// over the three phones (20261110231500_list_search_phone) — and is then
// checked exactly, so it stays fast at 200,000 contacts.

export type Lookalike = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  company: string | null;
  // Already linked to this person as an Additional Account (or their main
  // company): "+ Additional Account" has nothing to add.
  linked: boolean;
  reasons: ("email" | "phone" | "name")[];
};

export const LOOKALIKE_LIMIT = 5;

const lastTen = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};
const cleanName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

// Smaller id first, compared byte by byte (the SQL compares with COLLATE
// "C" to match).
export function pairKey(a: string, b: string): [string, string] {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0 ? [a, b] : [b, a];
}

export async function findLookalikes(
  organizationId: string,
  contact: { id: string; name: string; email: string | null; email2: string | null; phone: string | null; phone2: string | null; mobile: string | null; companyId: string | null },
  linkedCompanyIds: string[],
): Promise<Lookalike[]> {
  const emails = [...new Set([contact.email, contact.email2].map((value) => (value ?? "").trim().toLowerCase()).filter((value) => value.length >= 3))];
  const phones = [...new Set([contact.phone, contact.phone2, contact.mobile].map(lastTen).filter((value): value is string => Boolean(value)))];
  const name = cleanName(contact.name);
  const nameWords = name.split(" ").filter(Boolean);

  const tests: Prisma.Sql[] = [];
  const emailTest = emails.length
    ? Prisma.sql`(${Prisma.join(
        emails.map((email) => Prisma.sql`(c.email ILIKE ${likeText(email)} OR c.email2 ILIKE ${likeText(email)})`),
        " OR ",
      )})`
    : Prisma.sql`false`;
  const phoneTest = phones.length
    ? Prisma.sql`(${Prisma.join(
        phones.map(
          (digits) => Prisma.sql`(
            regexp_replace(coalesce(c."phone", '') || '|' || coalesce(c."phone2", '') || '|' || coalesce(c."mobile", ''), '[^0-9|]', '', 'g') LIKE ${`%${digits}%`}
            AND ${digits} IN (right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10), right(regexp_replace(coalesce(c.phone2, ''), '\\D', '', 'g'), 10), right(regexp_replace(coalesce(c.mobile, ''), '\\D', '', 'g'), 10)))`,
        ),
        " OR ",
      )})`
    : Prisma.sql`false`;
  // The same name, at a company other than theirs (or one of them with
  // none). A one-word name ("Mike") is too common to suggest on its own.
  const nameTest =
    nameWords.length >= 2 && name.length >= 5
      ? Prisma.sql`(c.name ILIKE ${`%${nameWords.map(likeText).join("%")}%`}
          AND lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) = ${name}
          AND c."companyId" IS DISTINCT FROM ${contact.companyId})`
      : Prisma.sql`false`;
  tests.push(emailTest, phoneTest, nameTest);

  const rows = await prisma.$queryRaw<
    { id: string; name: string; email: string | null; phone: string | null; companyId: string | null; company: string | null; byEmail: boolean; byPhone: boolean; byName: boolean }[]
  >`
    SELECT id, name, email, phone, "companyId", company, "byEmail", "byPhone", "byName" FROM (
      SELECT c.id, c.name, coalesce(c.email, c.email2) AS email, coalesce(c.mobile, c.phone, c.phone2) AS phone,
             c."companyId", co.name AS company, c."createdAt",
             coalesce(${emailTest}, false) AS "byEmail", coalesce(${phoneTest}, false) AS "byPhone", coalesce(${nameTest}, false) AS "byName"
        FROM "Contact" c
        LEFT JOIN "Company" co ON co.id = c."companyId"
       WHERE c."organizationId" = ${organizationId}
         AND c.id <> ${contact.id}
         AND (${Prisma.join(tests, " OR ")})
         AND NOT EXISTS (
           SELECT 1 FROM "DuplicateDismissal" d
            WHERE d."organizationId" = ${organizationId} AND d.kind = 'contact'
              AND d."aId" = least(c.id COLLATE "C", ${contact.id} COLLATE "C") AND d."bId" = greatest(c.id COLLATE "C", ${contact.id} COLLATE "C")
         )
       -- The strongest matches first, before the cap (audit fix: a shared
       -- office line could crowd out a record matching on email and phone).
       -- (A missing email is NULL, not false; NULLs sort first.)
       ORDER BY coalesce(${emailTest}, false)::int + coalesce(${phoneTest}, false)::int + coalesce(${nameTest}, false)::int DESC, c."createdAt", c.id
       LIMIT 50
    ) t
    ORDER BY ("byEmail")::int + ("byPhone")::int + ("byName")::int DESC, "createdAt", id
    LIMIT ${LOOKALIKE_LIMIT}`;
  const linked = new Set(linkedCompanyIds);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyId: row.companyId,
    company: row.company,
    linked: !row.companyId || linked.has(row.companyId),
    reasons: [...(row.byEmail ? (["email"] as const) : []), ...(row.byPhone ? (["phone"] as const) : []), ...(row.byName ? (["name"] as const) : [])],
  }));
}
