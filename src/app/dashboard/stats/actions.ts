"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { readLeaderboardColumns } from "@/lib/stats-columns";

// Remembers which leaderboard columns this person shows. Only the one key
// is written, merged into whatever else uiPrefs holds, so another screen's
// remembered choices are never overwritten.
export async function saveLeaderboardColumns(keys: string[]): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireSession();
  const parsed = z.array(z.string().max(40)).max(40).safeParse(keys);
  if (!parsed.success) return { error: "Those columns didn't make sense" };
  const columns = readLeaderboardColumns(parsed.data);
  await prisma.$executeRaw`
    UPDATE "User"
       SET "uiPrefs" = COALESCE("uiPrefs", '{}'::jsonb) || jsonb_build_object('statsColumns', ${JSON.stringify(columns)}::jsonb)
     WHERE id = ${userId}`;
  return { ok: true };
}
