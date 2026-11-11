"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { aiConfigured, askClaude } from "@/lib/ai";
import { AI_DAILY_CAPS } from "@/lib/ai-assist";
import { loadMyDay } from "./load";

// "43 new leads nobody owns · Take 10" on Up next (BDR redesign, Nov 11,
// 2026; decision 18). A claim a person makes, never automatic. It works
// like Bulk Assign's "Assign to me" (assignRecords), with two guards that
// matter here because two reps may tap Take 10 at the same moment: only
// leads still nobody's are taken, and Undo gives back only the ones this
// person still holds. Both also re-check that the lead is still new and
// untouched (audit, Nov 11, 2026): a lead a teammate called between the
// page loading and the tap isn't taken, and an Undo pressed after the rep
// has worked a lead keeps it, so it can't fall out of every Up next with
// no rep. One statement each; updatedAt is left alone, like
// Bulk Assign, so the lists don't reshuffle.

const idsSchema = z.array(z.string().trim().min(1).max(60)).min(1).max(50);

export async function takeUnownedLeads(ids: string[]): Promise<{ error: string } | { taken: string[] }> {
  const { organizationId, userId } = await requireSession();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Contact" SET "ownerId" = ${userId}
     WHERE "organizationId" = ${organizationId} AND id = ANY(${parsed.data}) AND "ownerId" IS NULL
       AND status = 'NOT_ACTIONED' AND "lastTouchAt" IS NULL
     RETURNING id`;
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contacts", "layout");
  if (rows.length === 0) return { error: "Someone else took those first." };
  return { taken: rows.map((row) => row.id) };
}

export async function giveBackLeads(ids: string[]): Promise<{ error?: string; returned?: number }> {
  const { organizationId, userId } = await requireSession();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const returned = await prisma.$executeRaw`
    UPDATE "Contact" SET "ownerId" = NULL
     WHERE "organizationId" = ${organizationId} AND id = ANY(${parsed.data}) AND "ownerId" = ${userId}
       AND status = 'NOT_ACTIONED' AND "lastTouchAt" IS NULL`;
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contacts", "layout");
  return { returned };
}

// "Rewrite" on My day's greeting (BDR redesign, Round 2): the same facts
// the rule-written sentence is made of, reworded by Claude. Only the
// signed-in person's own day. Every number in the answer must be one of
// the facts, or it is thrown out. Nothing is stored.
export async function rewriteGreeting(): Promise<{ sentence: string } | { error: string }> {
  const { organizationId, userId, name } = await requireSession();
  // Answer "no" before building the whole day (audit, Nov 11, 2026): with
  // the allowance used up, every tap still ran My day's fifteen reads.
  // askClaude still takes the allowance itself, so two taps on the last
  // one give it to exactly one.
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  const used = await prisma.aiRequest.count({
    where: { organizationId, kind: "MY_DAY_GREETING", createdAt: { gt: new Date(Date.now() - 86_400_000) } },
  });
  if (used >= AI_DAILY_CAPS.MY_DAY_GREETING) return { error: "Today's AI allowance for this is used up. It resets over the next 24 hours." };
  const day = await loadMyDay(organizationId, { id: userId, name: name ?? "there" });
  const facts = {
    firstName: (name ?? "there").trim().split(/\s+/)[0],
    plainSentence: day.greeting,
    followUpsLate: day.upNext.filter((row) => row.category === "late").length,
    meetingsToCloseOut: day.upNext.filter((row) => row.category === "meeting").length,
    peopleToCall: day.upNext.filter((row) => row.category !== "late" && row.category !== "meeting").length,
    meetingsToday: day.meetings.filter((row) => row.on === day.today).length,
    triesThisWeek: day.numbers.week.tries,
    talksThisWeek: day.numbers.week.talks,
    meetingsBookedThisWeek: day.numbers.week.booked,
    next: day.upNext[0] ? { name: day.upNext[0].name, why: day.upNext[0].reason } : null,
  };
  const answer = await askClaude({
    organizationId,
    userId,
    kind: "MY_DAY_GREETING",
    perDay: AI_DAILY_CAPS.MY_DAY_GREETING,
    system:
      "You write one short, warm greeting sentence (at most 30 words) for a sales rep opening their day in a CRM. Second person. Use only the facts given as JSON; never invent a number, name or company. Plain words, no emoji, no exclamation marks.",
    prompt: `Facts:\n${JSON.stringify(facts)}`,
    schema: z.object({ sentence: z.string().min(1).max(240) }),
    maxTokens: 400,
  });
  if ("error" in answer) return answer;
  const sentence = answer.data.sentence.trim();
  // Only the counts are numbers the answer may use (audit, Nov 11, 2026):
  // a next person called "Studio 54", or "3 tries" in their reason, let a
  // wrong 54 or 3 through when every digit in the facts counted.
  // The rule-written sentence's own numbers ("quiet 17 days") stay allowed.
  const allowed = new Set([
    ...Object.values(facts)
      .filter((value): value is number => typeof value === "number")
      .map(String),
    ...(facts.plainSentence.match(/\d+/g) ?? []),
  ]);
  const numbers = sentence.match(/\d+/g) ?? [];
  if (numbers.some((n) => !allowed.has(n))) return { error: "The AI's wording didn't match your numbers, so the plain one stays." };
  return { sentence };
}
