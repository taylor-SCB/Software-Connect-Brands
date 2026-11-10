import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";

// One way to ask Claude for a structured answer (Nov 10, 2026), shared by
// the report write-ups and the AI helpers on meetings, quotes, imports,
// labels and follow-ups. The same rules Suggest fields set
// (src/lib/template-import.ts): nothing happens without ANTHROPIC_API_KEY,
// ANTHROPIC_ENDPOINT points the browser suites at a stand-in, a per-kind
// daily allowance per workspace counted from AiRequest rows, the stop
// reason checked before the answer is read, and every failure a sentence
// rather than a dead page. Whatever comes back is a suggestion: callers
// show it for a person to accept and never save it on their own.

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type AiResult<T> = { data: T } | { error: string };

// Takes one of the day's allowance for this kind, or says it is used up.
// Each request counts the rows up to its own, so two at once on the last
// one give it to exactly one; the loser's row is taken back.
async function takeAllowance(organizationId: string, userId: string | null, kind: string, perDay: number) {
  const row = await prisma.aiRequest.create({ data: { organizationId, userId, kind }, select: { id: true, createdAt: true } });
  const used = await prisma.aiRequest.count({
    where: { organizationId, kind, createdAt: { gt: new Date(Date.now() - 86_400_000), lte: row.createdAt } },
  });
  if (used > perDay) {
    await prisma.aiRequest.delete({ where: { id: row.id } });
    return false;
  }
  return true;
}

export async function askClaude<S extends z.ZodType>(input: {
  organizationId: string;
  userId?: string | null;
  // The AiRequest kind, e.g. "REPORT_NARRATIVE", "MEETING_TO_OPPORTUNITY".
  kind: string;
  perDay: number;
  system: string;
  prompt: string;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<AiResult<z.infer<S>>> {
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  if (!(await takeAllowance(input.organizationId, input.userId ?? null, input.kind, input.perDay))) {
    return { error: "Today's AI allowance for this is used up. It resets over the next 24 hours." };
  }
  const client = new Anthropic({ baseURL: process.env.ANTHROPIC_ENDPOINT || undefined, timeout: 90_000, maxRetries: 1 });
  const format = betaZodOutputFormat(input.schema);
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: input.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      output_config: { effort: input.effort ?? "low", format },
    });
    if (response.stop_reason === "refusal") return { error: "The AI declined this one." };
    if (response.stop_reason === "max_tokens") return { error: "The AI's answer came back cut short. Try again." };
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    try {
      return { data: format.parse(text) as z.infer<S> };
    } catch {
      return { error: "The AI's answer came back unreadable. Try again." };
    }
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { error: "Too many AI requests just now. Try again in a minute." };
    if (error instanceof Anthropic.APIConnectionTimeoutError) return { error: "The AI took too long to answer. Try again." };
    if (error instanceof Anthropic.APIError) return { error: "The AI service didn't answer. Try again." };
    console.error(`[ai:${input.kind}]`, error);
    return { error: "The AI hit a problem. Try again." };
  }
}
