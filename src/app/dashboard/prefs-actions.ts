"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { PREF_NAME } from "@/lib/user-prefs";

// Remember one choice for the signed-in person (User.uiPrefs, read with
// readUiPrefs in src/lib/user-prefs.ts): saveUiPref("calendar", "scope",
// "mine"). Merged in the database inside its namespace, so two tabs saving
// different keys never undo each other and a malformed namespace is
// replaced rather than kept. Values are small: a word, a number, a yes/no,
// null or a short list of words; anything else is refused. The whole
// column stays under 16 KB.
const nameSchema = z.string().regex(PREF_NAME);
const valueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(80)).max(40),
]);

export async function saveUiPref(namespace: string, key: string, value: unknown): Promise<{ error?: string }> {
  const { userId } = await requireSession();
  const parsed = z.object({ namespace: nameSchema, key: nameSchema, value: valueSchema }).safeParse({ namespace, key, value });
  if (!parsed.success) return { error: "That choice can't be remembered" };
  const patch = JSON.stringify({ [parsed.data.key]: parsed.data.value });
  // Every read of the old value is of u itself, never a joined copy: when
  // two saves meet, the second waits for the first's row lock and then
  // re-reads u, so it builds on the first's write (a FROM subquery is not
  // re-read, and the first key was lost).
  const base = Prisma.sql`(CASE WHEN jsonb_typeof(u."uiPrefs") = 'object' THEN u."uiPrefs" ELSE '{}'::jsonb END)`;
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "User" u
                  SET "uiPrefs" = jsonb_set(
                        ${base},
                        ARRAY[${parsed.data.namespace}::text],
                        (CASE WHEN jsonb_typeof(${base} -> ${parsed.data.namespace}::text) = 'object'
                              THEN ${base} -> ${parsed.data.namespace}::text ELSE '{}'::jsonb END) || ${patch}::jsonb,
                        true)
                WHERE u.id = ${userId} AND pg_column_size(${base}) < 16000`,
  );
  return {};
}
