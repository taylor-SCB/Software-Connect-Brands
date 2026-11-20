"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { aiConfigured } from "@/lib/ai";
import { todayIso } from "@/lib/payments";
import { forecastWindow, loadForecast, storedForecastNotes, writeForecastNotes, type ForecastNotes } from "@/lib/forecast";

// The sentence behind each rep's forecast (AI release A, Nov 12, 2026):
// written once per set of numbers and kept, like the report write-ups.
// The page shows the rules sentences until this answers.

const repsSchema = z.array(z.string().trim().min(1).max(100)).max(20);

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const datesSchema = z.object({ from: daySchema, to: daySchema }).nullish();

export async function forecastNotes(
  repIds: string[],
  force = false,
  // The From–To picked on Stats, when it reaches past today.
  dates: { from: string; to: string } | null = null,
): Promise<{ notes: ForecastNotes } | { error: string }> {
  const { organizationId, userId } = await requireSession();
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  const parsed = repsSchema.safeParse(repIds);
  if (!parsed.success) return { error: "Those reps aren't valid" };
  // Only this workspace's people; a guessed id from another is dropped.
  const reps = parsed.data.length
    ? (await prisma.user.findMany({ where: { organizationId, id: { in: parsed.data } }, select: { id: true } })).map((row) => row.id)
    : [];
  if (reps.length !== parsed.data.length) return { error: "Those reps aren't valid" };
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true } });
  const timeZone = organization?.timeZone || "America/Chicago";
  const today = todayIso(timeZone);
  const picked = datesSchema.safeParse(dates);
  if (!picked.success) return { error: "Those dates aren't valid" };
  const window = picked.data && picked.data.from <= picked.data.to ? forecastWindow(today, picked.data.from, picked.data.to) : null;
  const forecast = await loadForecast(organizationId, { today, repIds: reps, timeZone, window });
  if (!force) {
    const kept = await storedForecastNotes(organizationId, reps, forecast);
    if (kept) return { notes: kept };
  }
  const result = await writeForecastNotes({ organizationId, userId, repIds: reps, forecast });
  return "error" in result ? result : { notes: result.notes };
}
