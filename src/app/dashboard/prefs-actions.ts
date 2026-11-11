"use server";

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

// Remember one choice for the signed-in person (User.uiPrefs, read with
// readUiPrefs in src/lib/user-prefs.ts). One key at a time, merged in the
// database with jsonb ||, so two tabs saving different keys never undo
// each other. Values are small: a word, a number, a yes/no or a short list
// of words; anything else is refused.
const keySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,40}$/);
const valueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(80)).max(40),
]);

export async function saveUiPref(key: string, value: unknown): Promise<{ error?: string }> {
  const { userId } = await requireSession();
  const parsed = z.object({ key: keySchema, value: valueSchema }).safeParse({ key, value });
  if (!parsed.success) return { error: "That choice can't be remembered" };
  const patch = JSON.stringify({ [parsed.data.key]: parsed.data.value });
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "User"
                  SET "uiPrefs" = CASE WHEN jsonb_typeof("uiPrefs") = 'object' THEN "uiPrefs" ELSE '{}'::jsonb END || ${patch}::jsonb
                WHERE id = ${userId} AND pg_column_size(COALESCE("uiPrefs", '{}'::jsonb)) < 16000`,
  );
  return {};
}
