import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { addDays } from "@/lib/payments";
import { formatCents, pct } from "@/lib/format";
import { askAi, readDraft, stampOf, writeDraft, type AiResult } from "@/lib/ai";

// The forecast that explains itself (Oct 2, 2026), on Stats / Reporting.
//
// It is arithmetic, not AI: every open deal at Quote Sent or Contract Sent
// is worth its value times the chance a deal at that step goes on to sign,
// and is expected to sign when deals at that step usually do. Both numbers
// come from this workspace's own history — deals that reached the step and
// then won, lost or archived — and every number on the screen carries the
// sentence that produced it.
//
// While history is thin the rates lean on a starting guess (30% of quotes
// and 60% of contracts sign, in about 30 and 14 days), weighted as if it
// were five closed deals, so one early win can't read as a 100% close rate.
// The panel says "low confidence" until there are 60 days of history and
// at least five closed deals behind a step.
//
// A deal running past twice its step's usual time is flagged, and its
// chance is halved: deals that drag mostly don't sign. The AI is only
// asked, on request, to read the finished numbers back in three sentences.

const DAY = 86_400_000;
const PRIOR_WEIGHT = 5;
const STAGES = ["QUOTE_SENT", "CONTRACT_SENT"] as const;
type Stage = (typeof STAGES)[number];
const PRIOR: Record<Stage, { rate: number; days: number }> = {
  QUOTE_SENT: { rate: 0.3, days: 30 },
  CONTRACT_SENT: { rate: 0.6, days: 14 },
};
const STAGE_NAMES: Record<Stage, string> = { QUOTE_SENT: "Quote Sent", CONTRACT_SENT: "Contract Sent" };
const LOW_HISTORY_DAYS = 60;
const MIN_CLOSED = 5;

export type StageRate = {
  stage: Stage;
  label: string;
  rate: number;
  days: number;
  won: number;
  lost: number;
  measured: boolean;
  sentence: string;
};

export type ForecastDeal = {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  rep: string | null;
  stage: Stage;
  valueCents: number;
  chance: number;
  weightedCents: number;
  ageDays: number;
  expectedOn: string;
  bucket: "this" | "next" | "later";
  dragging: boolean;
  sentence: string;
};

export type Bucket = { key: "this" | "next" | "later"; label: string; weightedCents: number; fullCents: number; deals: number; sentence: string };

export type Forecast = {
  rates: StageRate[];
  buckets: Bucket[];
  byRep: { name: string; thisCents: number; nextCents: number; deals: number }[];
  deals: ForecastDeal[];
  dragging: ForecastDeal[];
  lowConfidence: boolean;
  confidenceNote: string;
  historyDays: number;
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function monthEnd(iso: string, monthsAhead: number) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + monthsAhead + 1, 0)).toISOString().slice(0, 10);
}

export async function loadForecast(organizationId: string, options: { today: string; repIds: string[] }): Promise<Forecast> {
  const { today, repIds } = options;
  const since = new Date(Date.now() - 365 * DAY);

  const [changes, firstChange, open] = await Promise.all([
    prisma.statusChange.findMany({
      where: { organizationId, dealId: { not: null }, on: { gte: since }, toStatus: { in: [...STAGES, "WON", "LOST", "ARCHIVED"] } },
      select: { dealId: true, toStatus: true, on: true },
      orderBy: { on: "asc" },
      take: 50_000,
    }),
    prisma.statusChange.findFirst({ where: { organizationId }, orderBy: { on: "asc" }, select: { on: true } }),
    prisma.deal.findMany({
      where: { organizationId, stage: { in: [...STAGES] }, ...(repIds.length ? { ownerId: { in: repIds } } : {}) },
      orderBy: { stageChangedAt: "asc" },
      take: 2000,
      select: {
        id: true,
        title: true,
        stage: true,
        valueCents: true,
        stageChangedAt: true,
        quotes: QUOTES_FOR_VALUE,
        owner: { select: { name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Each deal's first day at each step, and how it ended.
  const journeys = new Map<string, { reached: Partial<Record<Stage, Date>>; wonOn?: Date; lostOn?: Date }>();
  for (const change of changes) {
    const journey = journeys.get(change.dealId!) ?? { reached: {} };
    if ((STAGES as readonly string[]).includes(change.toStatus)) journey.reached[change.toStatus as Stage] ??= change.on;
    else if (change.toStatus === "WON") journey.wonOn ??= change.on;
    else journey.lostOn ??= change.on;
    journeys.set(change.dealId!, journey);
  }

  const historyDays = firstChange ? Math.floor((Date.now() - firstChange.on.getTime()) / DAY) : 0;
  const rates: StageRate[] = STAGES.map((stage) => {
    let won = 0;
    let lost = 0;
    const waits: number[] = [];
    for (const journey of journeys.values()) {
      const reached = journey.reached[stage];
      if (!reached) continue;
      if (journey.wonOn) {
        won += 1;
        waits.push(Math.max(0, (journey.wonOn.getTime() - reached.getTime()) / DAY));
      } else if (journey.lostOn) lost += 1;
    }
    const prior = PRIOR[stage];
    const rate = (won + prior.rate * PRIOR_WEIGHT) / (won + lost + PRIOR_WEIGHT);
    const measuredDays = waits.length >= 3 ? median(waits) : null;
    const days = Math.max(1, Math.round(measuredDays ?? prior.days));
    const closed = won + lost;
    const measured = closed >= MIN_CLOSED;
    const label = STAGE_NAMES[stage];
    const sentence = measured
      ? `${label} signs ${pct(rate)} of the time, usually ${plural(days, "day")} later — from ${plural(closed, "closed deal")} (${won} won, ${lost} lost).`
      : closed === 0
        ? `No ${label} deal has closed yet, so this uses a starting guess: ${pct(prior.rate)} sign, about ${plural(prior.days, "day")} later.`
        : `${plural(closed, "closed deal")} so far (${won} won, ${lost} lost), blended with a starting guess of ${pct(prior.rate)}: ${pct(rate)}, about ${plural(days, "day")} to sign.`;
    return { stage, label, rate, days, won, lost, measured, sentence };
  });
  const rateOf = new Map(rates.map((row) => [row.stage, row]));

  const thisEnd = monthEnd(today, 0);
  const nextEnd = monthEnd(today, 1);
  const deals: ForecastDeal[] = open.map((deal) => {
    const stage = deal.stage as Stage;
    const rate = rateOf.get(stage)!;
    const value = dealValueCents(deal);
    const ageDays = Math.max(0, Math.floor((Date.now() - deal.stageChangedAt.getTime()) / DAY));
    const dragging = ageDays > Math.max(7, rate.days * 2);
    const chance = dragging ? rate.rate / 2 : rate.rate;
    const due = addDays(deal.stageChangedAt.toISOString().slice(0, 10), rate.days);
    // Past its usual day and not dragging yet: it is expected any day now.
    const expectedOn = due < today ? today : due;
    const bucket = expectedOn <= thisEnd ? "this" : expectedOn <= nextEnd ? "next" : "later";
    const weightedCents = Math.round(value * chance);
    const sentence = dragging
      ? `${STAGE_NAMES[stage]} ${plural(ageDays, "day")} — more than twice the usual ${rate.days}, so its ${pct(rate.rate)} is halved to ${pct(chance)}. ${formatCents(value)} × ${pct(chance)} = ${formatCents(weightedCents)}.`
      : `${STAGE_NAMES[stage]} ${plural(ageDays, "day")}; deals here sign ${pct(rate.rate)} of the time about ${plural(rate.days, "day")} in, so expected around ${DAY_FMT.format(new Date(`${expectedOn}T12:00:00Z`))}. ${formatCents(value)} × ${pct(chance)} = ${formatCents(weightedCents)}.`;
    return {
      id: deal.id,
      title: deal.title,
      contactId: deal.contact.id,
      contactName: deal.contact.name,
      rep: deal.owner?.name ?? null,
      stage,
      valueCents: value,
      chance,
      weightedCents,
      ageDays,
      expectedOn,
      bucket,
      dragging,
      sentence,
    };
  });

  const thisMonth = MONTH.format(new Date(`${today}T12:00:00Z`));
  const nextMonth = MONTH.format(new Date(`${addDays(thisEnd, 1)}T12:00:00Z`));
  const bucketLabels = { this: thisMonth, next: nextMonth, later: "Later" } as const;
  const buckets: Bucket[] = (["this", "next", "later"] as const).map((key) => {
    const inIt = deals.filter((deal) => deal.bucket === key);
    const weightedCents = inIt.reduce((sum, deal) => sum + deal.weightedCents, 0);
    const fullCents = inIt.reduce((sum, deal) => sum + deal.valueCents, 0);
    const quotes = inIt.filter((deal) => deal.stage === "QUOTE_SENT").length;
    const contracts = inIt.length - quotes;
    const sentence = inIt.length
      ? `${plural(inIt.length, "deal")} worth ${formatCents(fullCents)} are expected to decide${key === "later" ? " after that" : ` in ${bucketLabels[key]}`} (${plural(quotes, "quote")}, ${plural(contracts, "contract")}). Weighted by how often each step signs, about ${formatCents(weightedCents)} of it is likely.`
      : `Nothing open is expected to decide${key === "later" ? " after that" : ` in ${bucketLabels[key]}`}.`;
    return { key, label: bucketLabels[key], weightedCents, fullCents, deals: inIt.length, sentence };
  });

  const reps = new Map<string, { name: string; thisCents: number; nextCents: number; deals: number }>();
  for (const deal of deals) {
    const name = deal.rep ?? "No rep";
    const row = reps.get(name) ?? { name, thisCents: 0, nextCents: 0, deals: 0 };
    row.deals += 1;
    if (deal.bucket === "this") row.thisCents += deal.weightedCents;
    if (deal.bucket === "next") row.nextCents += deal.weightedCents;
    reps.set(name, row);
  }

  const thinHistory = historyDays < LOW_HISTORY_DAYS;
  const thinClosed = rates.some((row) => !row.measured);
  const lowConfidence = thinHistory || thinClosed;
  const confidenceNote = lowConfidence
    ? [
        thinHistory ? `The app has ${plural(historyDays, "day")} of history (it started recording on Sept 30, 2026); this firms up at ${LOW_HISTORY_DAYS}.` : "",
        thinClosed ? `A step needs ${MIN_CLOSED} closed deals before its rate is your own.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : `Built from ${plural(historyDays, "day")} of your own history.`;

  return {
    rates,
    buckets,
    byRep: [...reps.values()].sort((a, b) => b.thisCents - a.thisCents),
    deals: deals.sort((a, b) => a.expectedOn.localeCompare(b.expectedOn) || b.weightedCents - a.weightedCents),
    dragging: deals.filter((deal) => deal.dragging).sort((a, b) => b.valueCents - a.valueCents),
    lowConfidence,
    confidenceNote,
    historyDays,
  };
}

/* ------------------------------ Read it to me ----------------------------- */

const readingSchema = z.object({ reading: z.string().describe("Three short sentences at most, plain words.") });

function forecastFacts(forecast: Forecast) {
  return {
    rates: forecast.rates.map((row) => row.sentence),
    buckets: forecast.buckets.map((row) => row.sentence),
    reps: forecast.byRep.map((row) => `${row.name}: ${formatCents(row.thisCents)} likely this month, ${formatCents(row.nextCents)} next, ${plural(row.deals, "open deal")}`),
    dragging: forecast.dragging.slice(0, 8).map((deal) => `"${deal.title}" (${deal.contactName}, ${deal.rep ?? "no rep"}): ${deal.sentence}`),
    confidence: forecast.confidenceNote,
  };
}

export function forecastKey(repIds: string[]) {
  return `forecast:${[...repIds].sort().join(",") || "all"}`;
}

export async function storedReading(organizationId: string, repIds: string[], forecast: Forecast) {
  return readDraft<{ reading: string }>(organizationId, forecastKey(repIds), stampOf(forecastFacts(forecast)));
}

export async function readForecast(input: {
  organizationId: string;
  userId: string;
  timeZone: string;
  repIds: string[];
  forecast: Forecast;
}): Promise<AiResult<{ reading: string }>> {
  const facts = forecastFacts(input.forecast);
  const result = await askAi({
    organizationId: input.organizationId,
    userId: input.userId,
    timeZone: input.timeZone,
    feature: "forecast",
    effort: "low",
    maxTokens: 2000,
    schema: readingSchema,
    system:
      "You read a sales forecast back to the owner of a small trade or service business in three short sentences: what is likely to sign this month, which deals need a call because they are dragging, and how much to trust the numbers. Use only the figures given; never invent or recompute amounts.",
    prompt: JSON.stringify(facts, null, 1),
  });
  if (!result.ok) return result;
  const body = { reading: result.data.reading.trim() };
  await writeDraft(input.organizationId, forecastKey(input.repIds), stampOf(facts), body);
  return { ok: true, data: body };
}
