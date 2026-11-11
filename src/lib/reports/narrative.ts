import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { aiConfigured, askClaude } from "@/lib/ai";
import { REPORT_CODES, UNASSIGNED, type ReportKey } from "@/lib/reports/common";
import type { AnyReport, ReportChoice } from "@/lib/reports/index";
import type { PeriodRange } from "@/lib/reports/period";
import { changeText, days, formatValue, money, percent, plural } from "@/lib/reports/format";
import { formatIsoDay } from "@/lib/reports/period";

// The plain-words write-up at the top of every report (Nov 10, 2026).
//
// Two writers, one rule: only the numbers the report computed. When AI is
// switched on, Claude gets those numbers — already formatted, as JSON, and
// nothing else from the database — and is told to use only them; every
// number in its answer is then checked against them (formatting allowed:
// "$12k" for $12,345) and one that isn't there throws the answer out.
// Without AI, on any error, over the day's allowance or when a check fails,
// the write-up comes from the rules below, which is still useful prose:
// the biggest change, who's ahead and behind, what needs attention.
//
// Each write-up is kept in ReportNarrative under the report, period
// (with its dates), rep and breakdown, plus a fingerprint of the numbers,
// so it is written once and re-read until the numbers move; Rewrite asks
// again.

export const NARRATIVE_KIND = "REPORT_NARRATIVE";
// Per workspace per rolling day. A write-up is written only when a
// report's numbers change, so this is plenty for a small team and caps the
// cost at well under a dollar a workspace a day.
export const NARRATIVE_PER_DAY = 60;

export type NarrativeContext = {
  choice: ReportChoice;
  range: PeriodRange;
  repName: string | null;
  businessName: string;
};

export type Narrative = {
  key: string;
  body: string;
  source: "CLAUDE" | "RULES";
  // True when AI is on and this is the rules text standing in while the
  // AI version is written.
  pending: boolean;
};

/* --------------------------------- facts --------------------------------- */

type Facts = Record<string, unknown>;

// What the write-up may say, already formatted. The AI sees exactly this.
export function factsFor(report: AnyReport, ctx: NarrativeContext): Facts {
  const base: Facts = {
    business: ctx.businessName,
    report: report.kind,
    period: report.kind === "daily" ? `today, ${formatIsoDay(ctx.range.today, true)}` : `${ctx.range.label} (${ctx.range.span})`,
    comparedWith: ctx.range.compareLabel,
    whoFor: ctx.repName ?? "the whole team",
    headlines: report.headlines.map((headline) => {
      const moved = changeText(headline);
      return {
        label: headline.label,
        value: headline.empty ? "none yet" : formatValue(headline.value, headline.format),
        ...(headline.previous !== undefined && headline.previous !== null ? { before: formatValue(headline.previous, headline.format) } : {}),
        ...(moved && headline.format !== "percent" && headline.previous ? { change: moved.text.replace("▲", "up").replace("▼", "down") } : {}),
        ...(headline.hint ? { note: headline.hint } : {}),
      };
    }),
  };
  switch (report.kind) {
    case "daily":
      return {
        ...base,
        // Open entries first, each marked done or open (UX review, Nov 10,
        // 2026), so a call already made is never "next up".
        calendarEntries: report.calendar.count,
        calendarStillOpen: report.calendar.open,
        calendarAlreadyDone: report.calendar.count - report.calendar.open,
        calendarToday: report.calendar.items.map((item) => ({ title: item.title, time: item.time ?? "no time set", whose: item.owner, with: item.who, done: item.done })),
        overdueFollowUps: report.overdue.items.map((item) => ({ title: item.title, with: item.who, whose: item.owner, daysLate: item.days })),
        goneQuiet: report.quiet.items.map((item) => ({ title: item.title, daysQuiet: item.days, rep: item.owner })),
        paymentsYesterday: report.payments.items.map((item) => ({ customer: item.customer, amount: money(item.cents) })),
        quotesSentYesterday: report.quotes.items.map((item) => ({ customer: item.customer, amount: money(item.cents) })),
      };
    case "pipeline":
      return {
        ...base,
        stages: report.stages.map((stage) => ({ stage: stage.label, open: stage.count, value: money(stage.valueCents), averageDaysInStage: stage.avgAgeDays === null ? null : Math.round(stage.avgAgeDays) })),
        movedInPeriod: report.moves.map((move) => ({ step: move.label, now: move.count, before: move.previous })),
        conversions: report.conversions.map((row) => ({ from: row.from, to: row.to, rate: row.rate === null ? null : percent(row.rate), before: row.previousRate === null ? null : percent(row.previousRate) })),
        breakdown: report.groups.map((group) => ({ name: group.name, open: group.count, value: money(group.valueCents) })),
        oldestOpen: report.stuck.map((item) => ({ title: item.title, stage: item.stage, days: item.days, value: money(item.valueCents) })),
        aging: report.aging.map((bucket) => ({ bucket: bucket.label, open: bucket.count, value: money(bucket.valueCents) })),
      };
    case "activity":
      return {
        ...base,
        byKind: report.byType.map((row) => ({ kind: row.label, now: row.count, before: row.previous })),
        talks: { now: report.talks, before: report.previousTalks, countedFrom: report.talksSince ? report.talksSince.slice(0, 10) : null },
        breakdown: report.groups.map((group) => ({ name: group.name, touches: group.touches, talks: group.talks, notTouched: group.untouched, people: group.people })),
        peopleInScope: report.people,
        companiesTouched: report.companiesTouched,
      };
    case "closing":
      return {
        ...base,
        won: { deals: report.won.count, value: money(report.won.valueCents) },
        lost: { deals: report.lost.count, value: money(report.lost.valueCents) },
        before: { won: report.previousWon.count, wonValue: money(report.previousWon.valueCents), lost: report.previousLost.count },
        breakdown: report.groups.map((group) => ({
          name: group.name,
          won: group.won.count,
          wonValue: money(group.won.valueCents),
          lost: group.lost.count,
          winRate: group.winRate === null ? null : percent(group.winRate),
        })),
        biggestWins: report.biggestWins.map((win) => ({ title: win.title, value: money(win.valueCents), rep: win.rep })),
      };
    case "money":
      return {
        ...base,
        aging: report.buckets.map((bucket) => ({ bucket: bucket.label, value: money(bucket.cents) })),
        topDebtors: report.debtors.map((row) => ({ name: row.name, owed: money(row.owedCents), pastDue: money(row.overdueCents), daysLate: row.daysLate })),
        unsignedOldest: report.unsigned.oldest.map((row) => ({ contract: `CON-${row.number}`, customer: row.customer, daysWaiting: row.days, value: money(row.valueCents) })),
        breakdown: report.groups.map((group) => ({ name: group.name, owed: money(group.owedCents), pastDue: money(group.overdueCents) })),
      };
  }
}

/* ------------------------------ number check ------------------------------ */

// Numbers written as words count too (audit fix, Nov 10, 2026): "won two
// deals" was never checked. "One" only as a count, not "no one" or "one
// of".
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, dozen: 12,
};
const WORD_PATTERN = new RegExp(`(?<!\\bno\\s)\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b(?!\\s+of\\b)`, "gi");

// Dates are when, not how much (audit fix, Nov 10, 2026): the period's
// "Nov 1 – Nov 10, 2026" put 2026 among the allowed numbers, so "$2k" in a
// month that won nothing passed as 2026 give or take 500. Dates and years
// come out of the facts and the answer alike before they are compared.
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const DATE_PATTERN = new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4}\\b)?`, "g");
const YEAR_PATTERN = /(?<![$\d,.])\b(?:19|20)\d{2}\b(?![,.]?\d|\s*(?:k\b|K\b|m\b|M\b|%|million|thousand))/g;
export function withoutDates(text: string) {
  return text.replace(DATE_PATTERN, " ").replace(YEAR_PATTERN, " ");
}

// Every number written in a piece of text, with how far off it may be and
// still be the same number written another way: "$12k" is 12,000 give or
// take 500, "33%" is 33 give or take a half.
export function numbersIn(text: string): { value: number; tolerance: number }[] {
  const found: { value: number; tolerance: number }[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) found.push({ value: NUMBER_WORDS[match[1].toLowerCase()], tolerance: 0 });
  const pattern = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(k\b|K\b|m\b|M\b|million\b|thousand\b)?/g;
  for (const match of text.matchAll(pattern)) {
    const whole = match[1].replace(/,/g, "");
    const decimals = match[2] ?? "";
    const suffix = (match[3] ?? "").toLowerCase();
    const multiplier = suffix === "k" || suffix === "thousand" ? 1000 : suffix === "m" || suffix === "million" ? 1_000_000 : 1;
    const value = Number(`${whole}${decimals}`) * multiplier;
    const places = decimals ? decimals.length - 1 : 0;
    found.push({ value, tolerance: 0.5 * 10 ** -places * multiplier });
  }
  return found;
}

// The numbers in the AI's answer that aren't in the data it was given.
export function inventedNumbers(answer: string, facts: Facts): number[] {
  const allowed = numbersIn(withoutDates(JSON.stringify(facts))).map((entry) => entry.value);
  return numbersIn(withoutDates(answer))
    .filter((entry) => !allowed.some((value) => Math.abs(value - entry.value) <= entry.tolerance + 1e-9))
    .map((entry) => entry.value);
}

/* ------------------------------- the rules ------------------------------- */

function sentence(parts: (string | null | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

function lowerPeriod(range: PeriodRange) {
  return range.label.toLowerCase();
}

// The headline that moved most against the period before, in words.
function biggestMove(report: AnyReport, range: PeriodRange, skip: string[] = []): string | null {
  let best: { text: string; size: number } | null = null;
  for (const headline of report.headlines) {
    if (skip.includes(headline.id)) continue;
    if (headline.empty || headline.previous === undefined || headline.previous === null || headline.previous === headline.value) continue;
    const size = headline.previous ? Math.abs(headline.value - headline.previous) / Math.abs(headline.previous) : 1;
    const text = `${headline.label} ${headline.value > headline.previous ? "rose" : "fell"} to ${formatValue(headline.value, headline.format)} from ${formatValue(headline.previous, headline.format)} ${range.compareLabel}.`;
    if (!best || size > best.size) best = { text, size };
  }
  return best?.text ?? null;
}

export function rulesNarrative(report: AnyReport, ctx: NarrativeContext): string[] {
  const who = ctx.repName ?? "The team";
  const range = ctx.range;
  switch (report.kind) {
    case "daily": {
      // "Starting with" is the first entry still open, never one already
      // done (UX review, Nov 10, 2026).
      const first = report.calendar.items.find((item) => !item.done);
      const done = report.calendar.count - report.calendar.open;
      const oldest = report.overdue.items[0];
      const quiet = report.quiet.items[0];
      const p1 = sentence([
        report.calendar.count
          ? `${ctx.repName ? `${ctx.repName} has` : "The team has"} ${plural(report.calendar.count, "thing")} on the calendar today${
              !report.calendar.open ? ", all done" : done ? `, ${report.calendar.open} still open` : ""
            }${first ? `, starting with “${first.title}”${first.time ? ` at ${first.time}` : ""}` : ""}.`
          : `Nothing is on the calendar today${ctx.repName ? ` for ${ctx.repName}` : ""}.`,
        oldest
          ? `${plural(report.overdue.count, "follow-up")} ${report.overdue.count === 1 ? "is" : "are"} overdue — the oldest, “${oldest.title}”${oldest.who ? ` with ${oldest.who}` : ""}, is ${plural(oldest.days, "day")} late.`
          : "No follow-ups are overdue.",
        quiet
          ? `${plural(report.quiet.count, "opportunity", "opportunities")} ${report.quiet.count === 1 ? "has" : "have"} gone quiet (no touch in ${report.quiet.quietDays}+ days), led by “${quiet.title}” at ${plural(quiet.days, "day")}.`
          : "No open opportunity has gone quiet.",
      ]);
      const p2 = sentence([
        report.payments.count
          ? `Yesterday ${money(report.payments.cents)} came in from ${plural(report.payments.count, "payment")}${report.payments.items[0] ? `, the largest from ${report.payments.items[0].customer}` : ""}.`
          : "No payments were recorded yesterday.",
        `${plural(report.quotes.count, "quote")}${report.quotes.count ? ` worth ${money(report.quotes.cents)}` : ""} and ${plural(report.contracts.count, "contract")} went out, and ${plural(report.contacts.count, "new contact")} ${report.contacts.count === 1 ? "was" : "were"} added.`,
      ]);
      return [p1, p2];
    }
    case "pipeline": {
      const quote = report.stages.find((stage) => stage.stage === "QUOTE_SENT")!;
      const contract = report.stages.find((stage) => stage.stage === "CONTRACT_SENT")!;
      const meetings = report.stages.filter((stage) => stage.stage === "MEETING_SET" || stage.stage === "MEETING_COMPLETED").reduce((sum, stage) => sum + stage.count, 0);
      const moved = report.moves
        .filter((move) => move.count !== move.previous)
        .sort((a, b) => Math.abs(b.count - b.previous) - Math.abs(a.count - a.previous))[0];
      const p1 = sentence([
        report.openCount
          ? `${ctx.repName ? `${ctx.repName} has` : "There is"} ${money(report.openValueCents)} open in the pipeline right now across ${plural(report.openCount, "item")}: ${money(quote.valueCents)} in quotes out (${plural(quote.count, "deal")}), ${money(contract.valueCents)} in contracts waiting on a signature (${plural(contract.count, "deal")}), and ${plural(meetings, "opportunity", "opportunities")} still at the meeting stage.`
          : `Nothing is open in the pipeline right now${ctx.repName ? ` for ${ctx.repName}` : ""}.`,
        moved
          ? `${moved.label} ${moved.count > moved.previous ? "rose" : "fell"} to ${moved.count} ${lowerPeriod(range)}, from ${moved.previous} ${range.compareLabel}.`
          : `Movement ${lowerPeriod(range)} matched ${range.compareLabel}.`,
      ]);
      const ranked = report.groups.filter((group) => group.key !== "__other" && group.count > 0);
      const top = ranked[0];
      const bottom = ranked.length > 1 ? ranked[ranked.length - 1] : null;
      const stuck = report.stuck[0];
      const late = report.aging[report.aging.length - 1];
      const p2 = sentence([
        top
          ? ctx.choice.by === "rep"
            ? `${top.name} carries the most open value at ${money(top.valueCents)}${bottom ? `, and ${bottom.name} the least at ${money(bottom.valueCents)}` : ""}.`
            : `${top.name} is the biggest slice at ${money(top.valueCents)} (${plural(top.count, "item")}).`
          : null,
        stuck ? `The oldest open item is “${stuck.title}”, ${plural(stuck.days, "day")} in ${stuck.stage === "QUOTE_SENT" ? "Quote Sent" : stuck.stage === "CONTRACT_SENT" ? "Contract Sent" : stuck.stage === "MEETING_SET" ? "Meeting Set" : "Meeting Completed"}.` : null,
        late.count ? `${plural(late.count, "item")} ${late.count === 1 ? "has" : "have"} sat more than 90 days — worth a call or closing out.` : null,
      ]);
      return p2 ? [p1, p2] : [p1];
    }
    case "activity": {
      const type = (key: string) => report.byType.find((row) => row.type === key)!.count;
      const p1 = sentence([
        `${who} logged ${plural(report.touches, "touch", "touches")} ${lowerPeriod(range)} — ${plural(type("PHONE_CALL"), "call")}, ${plural(type("EMAIL"), "email")}, ${plural(type("TEXT"), "text")} and ${plural(type("MEETING"), "meeting")} — reaching ${plural(report.peopleTouched, "person", "people")}, against ${plural(report.previousTouches, "touch", "touches")} ${range.compareLabel}.`,
        report.touches
          ? report.talks === 1
            ? `1 of them was a talk (${percent(report.talks / report.touches)}).`
            : `${report.talks.toLocaleString("en-US")} of them were talks (${percent(report.talks / report.touches)}).`
          : null,
        biggestMove(report, range, ["touches", "marketing", "talks", "connect-rate"]),
        report.marketing ? `${plural(report.marketing, "marketing email")} went out as well, counted on their own.` : null,
      ]);
      const ranked = report.groups.filter((group) => group.key !== "__other");
      // Nobody logs as "Unassigned", so it is never the one behind.
      const byTouches = ranked.filter((group) => group.key !== UNASSIGNED).sort((a, b) => b.touches - a.touches);
      const mostUntouched = [...ranked].sort((a, b) => b.untouched - a.untouched)[0];
      const share = report.people ? report.untouched / report.people : 0;
      const p2 = sentence([
        byTouches.length > 1 && byTouches[0].touches !== byTouches[byTouches.length - 1].touches
          ? `${byTouches[0].name} ${ctx.choice.by === "rep" ? "logged" : "drew"} the most touches (${byTouches[0].touches}); ${byTouches[byTouches.length - 1].name} the fewest (${byTouches[byTouches.length - 1].touches}).`
          : null,
        report.people
          ? `${report.untouched.toLocaleString("en-US")} of ${report.people.toLocaleString("en-US")} people (${percent(share)}) had no touch ${lowerPeriod(range)}${mostUntouched && mostUntouched.untouched ? `, the most under ${mostUntouched.name} (${mostUntouched.untouched.toLocaleString("en-US")})` : ""}.`
          : null,
      ]);
      return p2 ? [p1, p2] : [p1];
    }
    case "closing": {
      const decided = report.won.count + report.lost.count;
      const p1 = decided
        ? sentence([
            `${who} won ${plural(report.won.count, "deal")} worth ${money(report.won.valueCents)} ${lowerPeriod(range)}, against ${plural(report.previousWon.count, "deal")} worth ${money(report.previousWon.valueCents)} ${range.compareLabel}.`,
            report.winRate !== null ? `The win rate is ${percent(report.winRate)} (${report.won.count} won, ${report.lost.count} lost).` : null,
            report.averageDealCents !== null && report.daysToClose !== null
              ? `The average win was ${money(report.averageDealCents)} and took ${days(report.daysToClose)} from first meeting to signed.`
              : null,
            biggestMove(report, range, ["won-value", "won-count", "win-rate", "avg-deal", "days-to-close"]),
          ])
        : `No deals were won or lost ${lowerPeriod(range)}${ctx.repName ? ` for ${ctx.repName}` : ""}; ${range.compareLabel} there ${report.previousWon.count === 1 ? "was" : "were"} ${plural(report.previousWon.count, "win")}.`;
      const ranked = report.groups.filter((group) => group.key !== "__other" && group.won.count + group.lost.count > 0);
      const top = ranked[0];
      const biggest = report.biggestWins[0];
      const p2 = sentence([
        top
          ? `${top.name} leads with ${money(top.won.valueCents)} won${top.winRate !== null ? ` (a ${percent(top.winRate)} win rate)` : ""}${ranked.length > 1 ? `; ${ranked[ranked.length - 1].name} has ${money(ranked[ranked.length - 1].won.valueCents)}` : ""}.`
          : null,
        biggest ? `The biggest win was “${biggest.title}” at ${money(biggest.valueCents)}.` : null,
        report.lost.count ? `${money(report.lost.valueCents)} was lost across ${plural(report.lost.count, "deal")} — worth asking why.` : null,
      ]);
      return p2 ? [p1, p2] : [p1];
    }
    case "money": {
      const top = report.debtors[0];
      const p1 = report.owedCents > 0
        ? sentence([
            `Customers owe ${money(report.owedCents)} in all${ctx.repName ? ` on ${ctx.repName}'s deals` : ""}, across ${plural(report.customers, "customer")}.`,
            report.overdueCents ? `${money(report.overdueCents)} of it is past due${report.buckets[4].cents ? `, including ${money(report.buckets[4].cents)} more than 90 days late` : ""}.` : "None of it is past due yet.",
            top ? `The biggest balance is ${top.name} at ${money(top.owedCents)}${top.daysLate ? `, ${plural(top.daysLate, "day")} past its oldest due date` : ""}.` : null,
          ])
        : `Nothing is owed right now${ctx.repName ? ` on ${ctx.repName}'s deals` : ""}.`;
      const oldest = report.unsigned.oldest[0];
      const p2 = sentence([
        `${money(report.collectedCents)} came in ${lowerPeriod(range)}, against ${money(report.previousCollectedCents)} ${range.compareLabel}.`,
        report.unsigned.count
          ? `${plural(report.unsigned.count, "contract")} worth ${money(report.unsigned.valueCents)} ${report.unsigned.count === 1 ? "is" : "are"} still waiting on a signature${oldest ? `; the oldest, CON-${oldest.number} to ${oldest.customer}, went out ${plural(oldest.days, "day")} ago` : ""}.`
          : "No contracts are waiting on a signature.",
      ]);
      return [p1, p2];
    }
  }
}

/* ------------------------------ the AI writer ------------------------------ */

const answerSchema = z.object({ paragraphs: z.array(z.string()).min(1).max(2) });

const SYSTEM = [
  "You write the short summary at the top of a sales report for the owner of a small service or trade business.",
  "Write one or two short paragraphs in plain, friendly words, as a sharp sales analyst talking to the owner. No headings, no bullet points, no markdown.",
  "Lead with the biggest change compared with the period before, then who is ahead or behind, then the one or two things that need attention.",
  "Use ONLY numbers that appear in the data, written as they appear there (rounding money to thousands like $12k is fine). Do not work out new numbers, percentages, differences or totals. Do not mention anything the data does not contain.",
].join(" ");

export async function aiNarrative(input: {
  organizationId: string;
  userId: string | null;
  facts: Facts;
}): Promise<string[] | null> {
  const result = await askClaude({
    organizationId: input.organizationId,
    userId: input.userId,
    kind: NARRATIVE_KIND,
    perDay: NARRATIVE_PER_DAY,
    system: SYSTEM,
    prompt: `The report's numbers, as JSON:\n\n${JSON.stringify(input.facts, null, 1)}\n\nWrite the summary.`,
    schema: answerSchema,
    maxTokens: 1200,
  });
  if ("error" in result) return null;
  const paragraphs = result.data.paragraphs.map((text) => text.trim()).filter(Boolean);
  if (paragraphs.length === 0 || paragraphs.some((text) => text.length > 1200)) return null;
  const invented = inventedNumbers(paragraphs.join("\n"), input.facts);
  if (invented.length) {
    console.warn(`[report-narrative] dropped an AI write-up with numbers not in the data: ${invented.join(", ")}`);
    return null;
  }
  return paragraphs;
}

/* --------------------------------- cache --------------------------------- */

// "PIPELINE|this-week:2026-11-09..2026-11-11|rep:all|by:rep" — the report as
// chosen; the stored key adds a fingerprint of the numbers.
export function narrativeBaseKey(report: ReportKey, ctx: NarrativeContext) {
  const range = ctx.range;
  return `${REPORT_CODES[report]}|${range.key}:${range.fromIso}..${range.toIso}|rep:${ctx.choice.repId ?? "all"}|by:${ctx.choice.by}`;
}

function fingerprint(facts: Facts) {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 16);
}

// What the page shows on first paint: the stored write-up when there is
// one for these numbers, otherwise the rules version — stored straight
// away when AI is off, shown as a stand-in (pending) when it is on.
export async function readNarrative(input: {
  organizationId: string;
  report: AnyReport;
  ctx: NarrativeContext;
}): Promise<Narrative> {
  const facts = factsFor(input.report, input.ctx);
  const key = `${narrativeBaseKey(input.ctx.choice.report, input.ctx)}|${fingerprint(facts)}`;
  const stored = await prisma.reportNarrative.findUnique({
    where: { organizationId_key: { organizationId: input.organizationId, key } },
    select: { body: true, source: true },
  });
  if (stored) return { key, body: stored.body, source: stored.source === "CLAUDE" ? "CLAUDE" : "RULES", pending: false };
  const body = rulesNarrative(input.report, input.ctx).join("\n\n");
  if (aiConfigured()) return { key, body, source: "RULES", pending: true };
  await store(input.organizationId, input.ctx, input.ctx.choice.report, key, body, "RULES");
  return { key, body, source: "RULES", pending: false };
}

// Writes (or with `force`, rewrites) the write-up for these numbers: AI
// when it is on and its answer passes the check, the rules otherwise.
export async function writeNarrative(input: {
  organizationId: string;
  userId: string | null;
  report: AnyReport;
  ctx: NarrativeContext;
  force?: boolean;
}): Promise<Narrative> {
  const facts = factsFor(input.report, input.ctx);
  const key = `${narrativeBaseKey(input.ctx.choice.report, input.ctx)}|${fingerprint(facts)}`;
  if (!input.force) {
    const stored = await prisma.reportNarrative.findUnique({
      where: { organizationId_key: { organizationId: input.organizationId, key } },
      select: { body: true, source: true },
    });
    if (stored) return { key, body: stored.body, source: stored.source === "CLAUDE" ? "CLAUDE" : "RULES", pending: false };
  }
  const ai = aiConfigured() ? await aiNarrative({ organizationId: input.organizationId, userId: input.userId, facts }) : null;
  const body = (ai ?? rulesNarrative(input.report, input.ctx)).join("\n\n");
  const source = ai ? "CLAUDE" : "RULES";
  await store(input.organizationId, input.ctx, input.ctx.choice.report, key, body, source);
  return { key, body, source, pending: false };
}

async function store(organizationId: string, ctx: NarrativeContext, report: ReportKey, key: string, body: string, source: "CLAUDE" | "RULES") {
  const base = narrativeBaseKey(report, ctx);
  await prisma.reportNarrative.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, body, source },
    update: { body, source, createdAt: new Date() },
  });
  // The same report's write-ups for numbers that have since moved.
  await prisma.reportNarrative.deleteMany({ where: { organizationId, key: { startsWith: `${base}|`, not: key } } });
  // And anything a month old: "this week" names new days every day.
  await prisma.reportNarrative.deleteMany({ where: { organizationId, createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
}
