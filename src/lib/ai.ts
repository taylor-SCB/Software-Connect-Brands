import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { todayIso } from "@/lib/payments";
import { dayInZone } from "@/lib/calendar-auto";

// The AI layer (Oct 2, 2026). One rule runs through every feature built on
// it: the app FINDS things with plain rules and counting — who to call, which
// records are twins, what is likely to sign — and the AI only WRITES: an
// opener, a briefing, a reading of somebody's meeting notes. So when the key
// is missing, the provider is down or a user is out of today's allowance,
// every list still shows and only the drafted words are missing.
//
// Nothing the AI writes is ever sent or saved into a record on its own. It
// lands in front of a person, who applies it.

export const AI_DAILY_LIMIT = 100;
export const AI_MODEL = "claude-opus-5-5";

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function anthropic() {
  // ANTHROPIC_BASE_URL is read by the SDK itself; the browser suites point
  // it at a local fake so nothing leaves the machine.
  client ??= new Anthropic({ maxRetries: 1, timeout: 45_000 });
  return client;
}

/** How many AI calls this person has used today, in the workspace's zone. */
export async function aiUsedToday(userId: string, timeZone: string) {
  const rows = await prisma.aiUsage.findMany({
    where: { userId, ok: true, createdAt: { gte: new Date(Date.now() - 26 * 60 * 60 * 1000) } },
    select: { createdAt: true },
  });
  const today = todayIso(timeZone);
  return rows.filter((row) => dayInZone(row.createdAt, timeZone) === today).length;
}

export type AiStatus = { configured: boolean; used: number; limit: number };

export async function aiStatus(userId: string, timeZone: string): Promise<AiStatus> {
  return { configured: aiConfigured(), used: await aiUsedToday(userId, timeZone), limit: AI_DAILY_LIMIT };
}

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * One structured request: the answer comes back already checked against
 * `schema`. Counts against the person's daily allowance only when it
 * succeeds, so a provider outage never eats anyone's 100.
 */
export async function askAi<S extends z.ZodType>(input: {
  organizationId: string;
  userId: string;
  timeZone: string;
  feature: string;
  system: string;
  prompt: string;
  schema: S;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<AiResult<z.infer<S>>> {
  if (!aiConfigured()) return { ok: false, error: "AI drafting isn't switched on for this workspace yet" };
  const used = await aiUsedToday(input.userId, input.timeZone);
  if (used >= AI_DAILY_LIMIT) {
    return { ok: false, error: `You've used today's ${AI_DAILY_LIMIT} AI drafts. They reset at midnight.` };
  }

  try {
    const response = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: input.maxTokens ?? 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      output_config: { effort: input.effort ?? "low", format: betaZodOutputFormat(input.schema) },
    });
    await prisma.aiUsage.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        feature: input.feature,
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        ok: response.stop_reason !== "refusal" && response.parsed_output != null,
      },
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "The AI wouldn't write that one. Try different wording." };
    if (response.parsed_output == null) return { ok: false, error: "The AI's answer came back garbled. Try again." };
    return { ok: true, data: response.parsed_output as z.infer<S> };
  } catch (error) {
    console.error(`[ai] ${input.feature} failed`, error);
    await prisma.aiUsage
      .create({ data: { organizationId: input.organizationId, userId: input.userId, feature: input.feature, ok: false } })
      .catch(() => undefined);
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "The AI is busy right now. Try again in a minute." };
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "The AI key in the settings isn't working. Tell the workspace owner." };
    return { ok: false, error: "Couldn't reach the AI just now. Everything else still works; try again shortly." };
  }
}

/* --------------------------------- Drafts -------------------------------- */

/** A fingerprint of what some words were written from. */
export function stampOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export async function readDraft<T>(organizationId: string, key: string, stamp?: string): Promise<T | null> {
  const row = await prisma.aiDraft.findUnique({ where: { organizationId_key: { organizationId, key } } });
  if (!row || (stamp && row.stamp !== stamp)) return null;
  return row.body as T;
}

export async function readDrafts<T>(organizationId: string, keys: string[]): Promise<Map<string, { stamp: string; body: T }>> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.aiDraft.findMany({ where: { organizationId, key: { in: keys } } });
  return new Map(rows.map((row) => [row.key, { stamp: row.stamp, body: row.body as T }]));
}

export async function writeDraft(organizationId: string, key: string, stamp: string, body: unknown) {
  const json = body as Prisma.InputJsonValue;
  await prisma.aiDraft.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, stamp, body: json },
    update: { stamp, body: json },
  });
}
