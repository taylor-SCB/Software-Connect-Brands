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

// What Claude is handed (Nov 12, 2026, the AI release): plain words, or
// words with pictures and documents. Everything here is data the helper
// gathered from the workspace or the person's upload; each helper's system
// prompt says so, and nothing inside is ever followed as an instruction.
// Put pictures and documents before the words that ask about them.
export type AiPart =
  | { type: "text"; text: string }
  // A picture, already made small in the browser (about 1,600 px on the
  // long side at most). JPEG unless there is a reason otherwise.
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string }
  // A PDF as uploaded (Claude reads its text and its pages as pictures).
  | { type: "pdf"; base64: string; title?: string }
  // Words read out of a file elsewhere (a Word file, a contract body).
  | { type: "document"; text: string; title?: string };

// The Messages API takes at most 5 MB of base64 per picture and 32 MB a
// request; a helper sending more than this many pictures is doing too much
// in one ask.
export const AI_MAX_IMAGES = 20;
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;
const MAX_REQUEST_BASE64 = 24 * 1024 * 1024;

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

function toBlocks(parts: AiPart[]): ContentBlock[] | { error: string } {
  let images = 0;
  let bytes = 0;
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      images += 1;
      bytes += part.base64.length;
      if (part.base64.length > MAX_IMAGE_BASE64) return { error: "A picture is too big for the AI to read. Try a smaller one." };
      blocks.push({ type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } });
    } else if (part.type === "pdf") {
      bytes += part.base64.length;
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: part.base64 }, ...(part.title ? { title: part.title } : {}) });
    } else {
      blocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: part.text }, ...(part.title ? { title: part.title } : {}) });
    }
  }
  if (images > AI_MAX_IMAGES) return { error: `The AI reads up to ${AI_MAX_IMAGES} pictures at a time.` };
  if (bytes > MAX_REQUEST_BASE64) return { error: "That's too much for the AI to read at once. Try fewer or smaller files." };
  if (blocks.length === 0) return { error: "There was nothing for the AI to read." };
  return blocks;
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
  // Plain words, or words with pictures and documents (AiPart above).
  prompt: string | AiPart[];
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  // How long to wait for the answer; 90 seconds unless a helper reads long
  // documents.
  timeoutMs?: number;
}): Promise<AiResult<z.infer<S>>> {
  if (!aiConfigured()) return { error: "AI isn't switched on for this site yet." };
  const content = typeof input.prompt === "string" ? input.prompt : toBlocks(input.prompt);
  if (typeof content !== "string" && "error" in content) return { error: content.error };
  if (!(await takeAllowance(input.organizationId, input.userId ?? null, input.kind, input.perDay))) {
    return { error: "Today's AI allowance for this is used up. It resets over the next 24 hours." };
  }
  const endpoint = process.env.ANTHROPIC_ENDPOINT || undefined;
  const client = new Anthropic({ baseURL: endpoint, timeout: input.timeoutMs ?? 90_000, maxRetries: 1 });
  const format = betaZodOutputFormat(input.schema);
  try {
    const response = await client.beta.messages.create(
      {
        model: "claude-opus-5-5",
        max_tokens: input.maxTokens ?? 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: input.system,
        messages: [{ role: "user", content }],
        output_config: { effort: input.effort ?? "low", format },
      },
      // The browser suites' stand-in Claude answers by kind. The label goes
      // only to a stand-in (ANTHROPIC_ENDPOINT), never to Anthropic.
      endpoint ? { headers: { "x-scb-ai-kind": input.kind } } : undefined,
    );
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
