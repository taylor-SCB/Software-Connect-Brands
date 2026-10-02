"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { loadForecast, readForecast } from "@/lib/forecast";

// "Read it to me" on the Forecast: three sentences from the finished numbers.
export async function readForecastAction(repIds: string[]): Promise<{ error?: string; reading?: string }> {
  const { organizationId, userId } = await requireSession();
  const ids = Array.isArray(repIds) ? repIds.map(String).slice(0, 20) : [];
  const owned = ids.length ? (await prisma.user.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } })).map((user) => user.id) : [];
  const timeZone = await getTimeZone();
  const forecast = await loadForecast(organizationId, { today: todayIso(timeZone), repIds: owned });
  const result = await readForecast({ organizationId, userId, timeZone, repIds: owned, forecast });
  if (!result.ok) return { error: result.error };
  return { reading: result.data.reading };
}
