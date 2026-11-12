import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { aiConfigured, askClaude } from "@/lib/ai";
import { AI_DAILY_CAPS } from "@/lib/ai-assist";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { addDays } from "@/lib/payments";
import { formatCents, pct } from "@/lib/format";
import { inventedNumbers } from "@/lib/reports/narrative";
import { fingerprintOf, inventedNames, readWriting, storeWriting } from "@/lib/ai-writing";

// The forecast on Stats (AI release A, Nov 12, 2026; first built on Oct 2
// and never shipped). Rules, not AI: every open deal at Quote Sent or
// Contract Sent is worth its value times the chance a deal at that step
// goes on to sign, and is expected to sign when deals at that step
// usually do. Both come from this workspace's own StatusChange history
// (recorded from Sept 30, 2026): deals that reached the step and then won
// or lost. While a step has few closed deals behind it the rate leans on
// a starting guess (30% of quotes and 60% of contracts sign, in about 30
// and 14 days), weighted as five closed deals, so one early win can't read
// as 100%.
//
// A deal past its step's usual time is flagged "running long"; past twice
// that, its chance is halved — deals that drag mostly don't sign.
//
// The whole forecast reads "Low confidence" until the workspace has 90
// days of status history. Behind each rep's number is one plain sentence:
// the rules write it, and with ANTHROPIC_API_KEY Claude may write it from
// those numbers only (every number checked); kept by a fingerprint of the
// numbers, like the report write-ups.

const DAY = 86_400_000;
const PRIOR_WEIGHT = 5;
export const FORECAST_STAGES = ["QUOTE_SENT", "CONTRACT_SENT"] as const;
type Stage = (typeof FORECAST_STAGES)[number];
const PRIOR: Record<Stage, { rate: number; days: number }> = {
  QUOTE_SENT: { rate: 0.3, days: 30 },
  CONTRACT_SENT: { rate: 0.6, days: 14 },
};
const STAGE_NAMES: Record<Stage, string> = { QUOTE_SENT: "Quote Sent", CONTRACT_SENT: "Contract Sent" };
export const CONFIDENT_AFTER_DAYS = 90;
const OPEN_LIMIT = 2000;

export type StageRate = { stage: Stage; label: string; rate: number; days: number; won: number; lost: number; sentence: string };

export type ForecastDeal = {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  repId: string | null;
  rep: string;
  stage: Stage;
  valueCents: number;
  chance: number;
  weightedCents: number;
  ageDays: number;
  usualDays: number;
  expectedOn: string;
  bucket: "this" | "next" | "later";
  long: boolean;
};

export type RepForecast = {
  id: string;
  name: string;
  deals: number;
  openCents: number;
  thisCents: number;
  nextCents: number;
  quotes: number;
  contracts: number;
  long: number;
  sentence: string;
};

export type Forecast = {
  today: string;
  thisMonth: string;
  nextMonth: string;
  rates: StageRate[];
  totals: { thisCents: number; nextCents: number; deals: number; openCents: number };
  reps: RepForecast[];
  long: ForecastDeal[];
  historyDays: number;
  lowConfidence: boolean;
  confidenceNote: string;
};

const NO_REP = "__none";
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthEnd(iso: string, ahead: number) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + ahead + 1, 0)).toISOString().slice(0, 10);
}

export function repSentence(rep: Omit<RepForecast, "sentence">, months: { thisMonth: string; nextMonth: string }) {
  if (rep.deals === 0) return `${rep.name} has no quotes or contracts out right now.`;
  const mix = [rep.quotes ? plural(rep.quotes, "quote") : null, rep.contracts ? plural(rep.contracts, "contract") : null].filter(Boolean).join(" and ");
  const long = rep.long ? ` ${plural(rep.long, "deal is", "deals are")} running past the usual time.` : "";
  return `${rep.name} has ${mix} out worth ${formatCents(rep.openCents)}; about ${formatCents(rep.thisCents)} is likely to sign in ${months.thisMonth} and ${formatCents(rep.nextCents)} in ${months.nextMonth}.${long}`;
}

export async function loadForecast(organizationId: string, options: { today: string; repIds: string[] }): Promise<Forecast> {
  const { today, repIds } = options;
  const since = new Date(Date.now() - 365 * DAY);
  const [changes, firstChange, open] = await Promise.all([
    prisma.statusChange.findMany({
      where: { organizationId, dealId: { not: null }, on: { gte: since }, toStatus: { in: [...FORECAST_STAGES, "WON", "LOST"] } },
      select: { dealId: true, toStatus: true, on: true },
      orderBy: { on: "asc" },
      take: 50_000,
    }),
    prisma.statusChange.findFirst({ where: { organizationId }, orderBy: { on: "asc" }, select: { on: true } }),
    prisma.deal.findMany({
      where: { organizationId, stage: { in: [...FORECAST_STAGES] }, ...(repIds.length ? { ownerId: { in: repIds } } : {}) },
      orderBy: { stageChangedAt: "asc" },
      take: OPEN_LIMIT,
      select: {
        id: true,
        title: true,
        stage: true,
        valueCents: true,
        stageChangedAt: true,
        ownerId: true,
        quotes: QUOTES_FOR_VALUE,
        owner: { select: { name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Each deal's first day at each step, and how it ended (a contact's own
  // move carries the deal too, so the earliest of each is kept).
  const journeys = new Map<string, { reached: Partial<Record<Stage, Date>>; wonOn?: Date; lost?: boolean }>();
  for (const change of changes) {
    const journey = journeys.get(change.dealId!) ?? { reached: {} };
    if ((FORECAST_STAGES as readonly string[]).includes(change.toStatus)) journey.reached[change.toStatus as Stage] ??= change.on;
    else if (change.toStatus === "WON") journey.wonOn ??= change.on;
    else journey.lost = true;
    journeys.set(change.dealId!, journey);
  }

  const historyDays = firstChange ? Math.max(0, Math.floor((Date.now() - firstChange.on.getTime()) / DAY)) : 0;
  const rates: StageRate[] = FORECAST_STAGES.map((stage) => {
    let won = 0;
    let lost = 0;
    const waits: number[] = [];
    for (const journey of journeys.values()) {
      const reached = journey.reached[stage];
      if (!reached) continue;
      if (journey.wonOn) {
        won += 1;
        waits.push(Math.max(0, (journey.wonOn.getTime() - reached.getTime()) / DAY));
      } else if (journey.lost) lost += 1;
    }
    const prior = PRIOR[stage];
    const rate = (won + prior.rate * PRIOR_WEIGHT) / (won + lost + PRIOR_WEIGHT);
    const measured = waits.length >= 3 ? median(waits) : null;
    const days = Math.max(1, Math.round(measured ?? prior.days));
    const closed = won + lost;
    const label = STAGE_NAMES[stage];
    const sentence =
      closed === 0
        ? `No deal at ${label} has closed yet, so this uses a starting guess: ${pct(prior.rate)} sign, about ${plural(prior.days, "day")} later.`
        : `${plural(closed, "deal")} at ${label} closed (${won} won, ${lost} lost); blended with a starting guess that makes ${pct(rate)} sign, usually ${plural(days, "day")} later.`;
    return { stage, label, rate, days, won, lost, sentence };
  });
  const rateOf = new Map(rates.map((row) => [row.stage, row]));

  const thisEnd = monthEnd(today, 0);
  const nextEnd = monthEnd(today, 1);
  const thisMonth = MONTH.format(new Date(`${today}T12:00:00Z`));
  const nextMonth = MONTH.format(new Date(`${addDays(thisEnd, 1)}T12:00:00Z`));
  const deals: ForecastDeal[] = open.map((deal) => {
    const stage = deal.stage as Stage;
    const rate = rateOf.get(stage)!;
    const value = dealValueCents(deal);
    const ageDays = Math.max(0, Math.floor((Date.now() - deal.stageChangedAt.getTime()) / DAY));
    const long = ageDays > rate.days;
    const chance = ageDays > rate.days * 2 ? rate.rate / 2 : rate.rate;
    const due = addDays(deal.stageChangedAt.toISOString().slice(0, 10), rate.days);
    const expectedOn = due < today ? today : due;
    return {
      id: deal.id,
      title: deal.title,
      contactId: deal.contact.id,
      contactName: deal.contact.name,
      repId: deal.ownerId,
      rep: deal.owner?.name ?? "No rep",
      stage,
      valueCents: value,
      chance,
      weightedCents: Math.round(value * chance),
      ageDays,
      usualDays: rate.days,
      expectedOn,
      bucket: expectedOn <= thisEnd ? "this" : expectedOn <= nextEnd ? "next" : "later",
      long,
    };
  });

  const byRep = new Map<string, Omit<RepForecast, "sentence">>();
  for (const deal of deals) {
    const key = deal.repId ?? NO_REP;
    const row = byRep.get(key) ?? { id: key, name: deal.rep, deals: 0, openCents: 0, thisCents: 0, nextCents: 0, quotes: 0, contracts: 0, long: 0 };
    row.deals += 1;
    row.openCents += deal.valueCents;
    if (deal.bucket === "this") row.thisCents += deal.weightedCents;
    if (deal.bucket === "next") row.nextCents += deal.weightedCents;
    if (deal.stage === "QUOTE_SENT") row.quotes += 1;
    else row.contracts += 1;
    if (deal.long) row.long += 1;
    byRep.set(key, row);
  }
  const months = { thisMonth, nextMonth };
  const reps = [...byRep.values()]
    .sort((a, b) => b.thisCents - a.thisCents || b.openCents - a.openCents || a.name.localeCompare(b.name))
    .map((rep) => ({ ...rep, sentence: repSentence(rep, months) }));

  const lowConfidence = historyDays < CONFIDENT_AFTER_DAYS;
  const confidenceNote = lowConfidence
    ? `Low confidence: the app has only ${plural(historyDays, "day")} of your deals moving between steps, and a forecast needs about ${CONFIDENT_AFTER_DAYS} days of them before it means much. Until then the rates lean on a starting guess.`
    : `Built from ${plural(historyDays, "day")} of your own deals moving between steps.`;

  return {
    today,
    thisMonth,
    nextMonth,
    rates,
    totals: {
      thisCents: deals.filter((deal) => deal.bucket === "this").reduce((sum, deal) => sum + deal.weightedCents, 0),
      nextCents: deals.filter((deal) => deal.bucket === "next").reduce((sum, deal) => sum + deal.weightedCents, 0),
      deals: deals.length,
      openCents: deals.reduce((sum, deal) => sum + deal.valueCents, 0),
    },
    reps,
    long: deals.filter((deal) => deal.long).sort((a, b) => b.valueCents - a.valueCents).slice(0, 10),
    historyDays,
    lowConfidence,
    confidenceNote,
  };
}

/* --------------------------- the AI's sentences --------------------------- */

// What Claude may use for one rep: the numbers, already formatted.
function repFacts(rep: RepForecast, forecast: Forecast) {
  return {
    rep: rep.name,
    openDeals: rep.deals,
    quotesOut: rep.quotes,
    contractsOut: rep.contracts,
    openValue: formatCents(rep.openCents),
    likelyThisMonth: { month: forecast.thisMonth, value: formatCents(rep.thisCents) },
    likelyNextMonth: { month: forecast.nextMonth, value: formatCents(rep.nextCents) },
    runningLong: rep.long,
    lowConfidence: forecast.lowConfidence,
  };
}

export function forecastKey(repIds: string[]) {
  return `forecast:${[...repIds].sort().join(",") || "all"}`;
}

export function forecastFingerprint(forecast: Forecast) {
  return fingerprintOf({ months: [forecast.thisMonth, forecast.nextMonth], reps: forecast.reps.map((rep) => repFacts(rep, forecast)) });
}

export type ForecastNotes = Record<string, string>;

export async function storedForecastNotes(organizationId: string, repIds: string[], forecast: Forecast) {
  if (!aiConfigured() || forecast.reps.length === 0) return null;
  return readWriting<ForecastNotes>(organizationId, forecastKey(repIds), forecastFingerprint(forecast));
}

const notesSchema = z.object({
  reps: z.array(z.object({ id: z.string(), sentence: z.string() })),
});

// One sentence per rep from that rep's numbers only. A sentence with a
// number or a name not in its rep's facts, or an id that wasn't offered,
// is dropped and that rep keeps the rules sentence.
export async function writeForecastNotes(input: {
  organizationId: string;
  userId: string;
  repIds: string[];
  forecast: Forecast;
}): Promise<{ notes: ForecastNotes; dropped: number } | { error: string }> {
  const { forecast } = input;
  if (forecast.reps.length === 0) return { notes: {}, dropped: 0 };
  const offered = forecast.reps.slice(0, 20);
  const facts = offered.map((rep) => ({ id: rep.id, ...repFacts(rep, forecast) }));
  const answer = await askClaude({
    organizationId: input.organizationId,
    userId: input.userId,
    kind: "FORECAST_NOTE",
    perDay: AI_DAILY_CAPS.FORECAST_NOTE,
    system:
      "You explain a small service business's sales forecast to its owner, one plain sentence per salesperson: what they have out and what is likely to sign when. " +
      "Use ONLY the numbers given for that person, written as they appear (rounding money to thousands like $12k is fine). Do not work out new numbers, totals or percentages. " +
      "When lowConfidence is true, say the forecast is early. Answer with each person's id exactly as given.",
    prompt: `The forecast's numbers, one entry per salesperson, as JSON:\n${JSON.stringify(facts, null, 1)}\n\nWrite one sentence for each.`,
    schema: notesSchema,
    maxTokens: 2000,
  });
  if ("error" in answer) return answer;
  const notes: ForecastNotes = {};
  let dropped = 0;
  for (const row of answer.data.reps) {
    const fact = facts.find((entry) => entry.id === row.id);
    const sentence = row.sentence.trim();
    if (!fact || !sentence || sentence.length > 400 || notes[row.id]) {
      dropped += 1;
      continue;
    }
    if (inventedNumbers(sentence, fact).length || inventedNames(sentence, fact).length) {
      dropped += 1;
      continue;
    }
    notes[row.id] = sentence;
  }
  if (dropped) console.warn(`[forecast] dropped ${dropped} AI sentence(s) that didn't match the numbers`);
  await storeWriting(input.organizationId, forecastKey(input.repIds), forecastFingerprint(forecast), notes);
  return { notes, dropped };
}
