"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { LIST_SCOPES, LIST_SORTS, CONTACT_PRESETS, COMPANY_PRESETS } from "@/lib/list-params";
import { CONTACT_COLUMNS, COMPANY_COLUMNS } from "@/lib/list-columns";

// Remember a list choice for the signed-in person (BDR redesign, Nov 11,
// 2026): User.uiPrefs, keys "contacts.scope", "companies.sort" and so on,
// read back by resolveListView in src/lib/list-prefs.ts. Only the keys
// given are written, merged in the database with jsonb ||, so another
// screen's choices and another tab's are never undone. Every value is
// checked against what the lists offer.
const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contacts"),
    scope: z.enum(LIST_SCOPES).optional(),
    preset: z.enum([...CONTACT_PRESETS, "none"]).optional(),
    sort: z.enum(LIST_SORTS).nullable().optional(),
    columns: z.array(z.enum(CONTACT_COLUMNS)).max(20).optional(),
  }),
  z.object({
    kind: z.literal("companies"),
    scope: z.enum(LIST_SCOPES).optional(),
    preset: z.enum([...COMPANY_PRESETS, "none"]).optional(),
    sort: z.enum(LIST_SORTS).nullable().optional(),
    columns: z.array(z.enum(COMPANY_COLUMNS)).max(20).optional(),
  }),
]);

export async function saveListPrefs(input: z.input<typeof schema>): Promise<{ error?: string }> {
  const { userId } = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "That choice can't be remembered" };
  const { kind, ...rest } = parsed.data;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) patch[`${kind}.${key}`] = value;
  }
  if (Object.keys(patch).length === 0) return {};
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "User"
                  SET "uiPrefs" = CASE WHEN jsonb_typeof("uiPrefs") = 'object' THEN "uiPrefs" ELSE '{}'::jsonb END || ${JSON.stringify(patch)}::jsonb
                WHERE id = ${userId} AND pg_column_size(COALESCE("uiPrefs", '{}'::jsonb)) < 16000`,
  );
  return {};
}
