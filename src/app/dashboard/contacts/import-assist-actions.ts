"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { aiConfigured, askClaude } from "@/lib/ai";
import { AI_DAILY_CAPS } from "@/lib/ai-assist";
import { CONTACT_CSV_COLUMNS, CONTACT_CSV_LABELS, type ContactCsvColumn } from "@/lib/contacts-csv";
import { phoneKey } from "@/lib/import-duplicates";

// The contacts import's clean-up before Import (Nov 10, 2026): rows that
// look like contacts already on file, and (with AI on) where the columns
// the planner left out probably belong. Both only read; the import itself
// is untouched until the person presses Import.

export async function importAssistAvailable() {
  await requireSession();
  return { ai: aiConfigured() };
}

const rowSchema = z.object({
  line: z.number().int().positive(),
  name: z.string().max(200).nullable(),
  email: z.string().max(200).nullable(),
  phones: z.array(z.string().max(40)).max(3),
  company: z.string().max(200).nullable(),
});

export type ExistingMatch = { line: number; contactId: string; contactName: string; reason: string; updates: boolean };

// Up to 1,000 rows a call: which look like a contact already in the
// workspace, by email (the import updates those), by phone or mobile
// digits, or by the same name at the same company.
export async function checkImportDuplicates(input: z.input<typeof rowSchema>[]): Promise<{ matches: ExistingMatch[] } | { error: string }> {
  const { organizationId } = await requireSession();
  const parsed = z.array(rowSchema).max(1000).safeParse(input);
  if (!parsed.success) return { error: "Those rows couldn't be checked" };
  const rows = parsed.data;
  const emails = [...new Set(rows.flatMap((row) => (row.email ? [row.email.trim().toLowerCase()] : [])))];
  const digits = [...new Set(rows.flatMap((row) => row.phones.map(phoneKey).filter((key): key is string => Boolean(key))))];
  const names = [...new Set(rows.flatMap((row) => (row.name && row.company ? [row.name.trim().toLowerCase()] : [])))];
  if (emails.length + digits.length + names.length === 0) return { matches: [] };
  const found = await prisma.$queryRaw<
    { id: string; name: string; email: string | null; email2: string | null; p1: string; p2: string; p3: string; company: string | null }[]
  >`
    SELECT c.id, c.name, lower(c.email) AS email, lower(c.email2) AS email2,
           right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) AS p1,
           right(regexp_replace(coalesce(c.phone2, ''), '\\D', '', 'g'), 10) AS p2,
           right(regexp_replace(coalesce(c.mobile, ''), '\\D', '', 'g'), 10) AS p3,
           lower(co.name) AS company
      FROM "Contact" c
      LEFT JOIN "Company" co ON co.id = c."companyId"
     WHERE c."organizationId" = ${organizationId}
       AND (lower(c.email) = ANY(${emails}::text[])
         OR lower(c.email2) = ANY(${emails}::text[])
         OR right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) = ANY(${digits}::text[])
         OR right(regexp_replace(coalesce(c.phone2, ''), '\\D', '', 'g'), 10) = ANY(${digits}::text[])
         OR right(regexp_replace(coalesce(c.mobile, ''), '\\D', '', 'g'), 10) = ANY(${digits}::text[])
         OR lower(c.name) = ANY(${names}::text[]))
     LIMIT 5000`;
  const matches: ExistingMatch[] = [];
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase() || null;
    const keys = row.phones.map(phoneKey).filter((key): key is string => Boolean(key));
    for (const contact of found) {
      let reason: string | null = null;
      let updates = false;
      if (email && (contact.email === email || contact.email2 === email)) {
        reason = "same email";
        updates = true;
      } else if (keys.some((key) => key === contact.p1 || key === contact.p2 || key === contact.p3)) reason = "same phone number";
      else if (row.name && row.company && contact.company && contact.name.toLowerCase() === row.name.trim().toLowerCase() && contact.company === row.company.trim().toLowerCase())
        reason = "same name at the same company";
      if (reason) {
        matches.push({ line: row.line, contactId: contact.id, contactName: contact.name, reason, updates });
        break;
      }
    }
  }
  return { matches };
}

const headerSchema = z.object({
  index: z.number().int().min(0).max(500),
  header: z.string().max(120),
  samples: z.array(z.string().max(120)).max(3),
});

const answerSchema = z.object({
  mappings: z.array(
    z.object({
      index: z.number().describe("The column's index as given"),
      field: z.string().nullable().describe("One of the field names exactly, or null when it fits none"),
      reason: z.string(),
    }),
  ),
});

export type HeaderSuggestion = { index: number; header: string; column: ContactCsvColumn; reason: string };

// For the headers the planner left out: which contact field each most
// likely is, from the header and three sample values. A field the planner
// already filled, or one not in CONTACT_CSV_COLUMNS, is dropped.
export async function suggestImportHeaders(input: {
  headers: z.input<typeof headerSchema>[];
  taken: string[];
}): Promise<{ suggestions: HeaderSuggestion[] } | { error: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = z.object({ headers: z.array(headerSchema).min(1).max(30), taken: z.array(z.string().max(40)).max(40) }).safeParse(input);
  if (!parsed.success) return { error: "Those columns couldn't be read" };
  const taken = new Set(parsed.data.taken);
  const open = CONTACT_CSV_COLUMNS.filter((column) => !taken.has(column));
  if (open.length === 0) return { suggestions: [] };
  const answer = await askClaude({
    organizationId,
    userId,
    kind: "IMPORT_HEADERS",
    perDay: AI_DAILY_CAPS.IMPORT_HEADERS,
    system:
      "You map spreadsheet columns onto a CRM's contact import fields. Use the header and the sample values. " +
      "Answer null for a column that fits none of the fields, such as notes or ids. Each field at most once.",
    prompt: [
      `Fields still open (name: meaning): ${open.map((column) => `${column}: ${CONTACT_CSV_LABELS[column]}`).join("; ")}.`,
      "Columns:",
      ...parsed.data.headers.map((row) => `${row.index}: "${row.header}" e.g. ${row.samples.map((value) => JSON.stringify(value)).join(", ") || "(empty)"}`),
    ].join("\n"),
    schema: answerSchema,
    maxTokens: 2000,
  });
  if ("error" in answer) return answer;
  const used = new Set<string>();
  const suggestions: HeaderSuggestion[] = [];
  for (const row of answer.data.mappings) {
    const header = parsed.data.headers.find((item) => item.index === row.index);
    const column = open.find((name) => name === row.field);
    if (!header || !column || used.has(column)) continue;
    used.add(column);
    suggestions.push({ index: header.index, header: header.header, column, reason: row.reason.slice(0, 160) });
  }
  return { suggestions };
}
