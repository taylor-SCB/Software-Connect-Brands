"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { askClaude } from "@/lib/ai";
import { AI_DAILY_CAPS } from "@/lib/ai-assist";
import { loadMyDay } from "./load";

// "43 new leads nobody owns · Take 10" on Up next (BDR redesign, Nov 11,
// 2026; decision 18). A claim a person makes, never automatic. It works
// like Bulk Assign's "Assign to me" (assignRecords), with two guards that
// matter here because two reps may tap Take 10 at the same moment: only
// leads still nobody's are taken, and Undo gives back only the ones this
// person still holds. One statement each; updatedAt is left alone, like
// Bulk Assign, so the lists don't reshuffle.

const idsSchema = z.array(z.string().trim().min(1).max(60)).min(1).max(50);

export async function takeUnownedLeads(ids: string[]): Promise<{ error: string } | { taken: string[] }> {
  const { organizationId, userId } = await requireSession();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Contact" SET "ownerId" = ${userId}
     WHERE "organizationId" = ${organizationId} AND id = ANY(${parsed.data}) AND "ownerId" IS NULL
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
     WHERE "organizationId" = ${organizationId} AND id = ANY(${parsed.data}) AND "ownerId" = ${userId}`;
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
  const allowed = new Set(JSON.stringify(facts).match(/\d+/g) ?? []);
  const numbers = sentence.match(/\d+/g) ?? [];
  if (numbers.some((n) => !allowed.has(n))) return { error: "The AI's wording didn't match your numbers, so the plain one stays." };
  return { sentence };
}
