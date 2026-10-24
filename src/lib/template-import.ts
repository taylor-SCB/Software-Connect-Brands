import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { MERGE_FIELDS, mergeFieldFor, mergeToken } from "@/lib/merge";

// Reading an uploaded agreement happens in the browser, in
// src/lib/template-file.ts; this file is only the Suggest fields call.

/* --------------------------- Suggest fields --------------------------- */

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// `replaced` is the blank or value the field takes the place of: the one
// thing that changes, and what the screen shows.
export type FieldSuggestion = { find: string; replaceWith: string; key: string; label: string; replaced: string };

// Each call costs up to about 40 cents on a long agreement, on the site's
// own key, so a workspace gets this many a day. Setting up six templates
// takes a handful.
export const DAILY_SUGGEST_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

// Takes one of the workspace's calls for the last 24 hours, or says the
// day's are used. The row goes in before the count so two clicks at the
// same moment can't both take the last one.
export async function claimSuggestion(organizationId: string, userId: string): Promise<string | null> {
  const row = await prisma.aiRequest.create({
    data: { organizationId, userId, kind: "SUGGEST_FIELDS" },
    select: { id: true },
  });
  const used = await prisma.aiRequest.count({
    where: { organizationId, kind: "SUGGEST_FIELDS", createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if (used <= DAILY_SUGGEST_LIMIT) return null;
  await prisma.aiRequest.delete({ where: { id: row.id } });
  return `Suggest fields has been used ${DAILY_SUGGEST_LIMIT} times in your workspace in the last 24 hours. Place the rest with the chips, or try again tomorrow.`;
}

// A blank or a value, not a clause: a suggestion that swaps out more than
// this is rewriting the agreement, not placing a field.
const MAX_REPLACED_CHARS = 160;

// replaceWith has to be find with one stretch swapped for {{key}} and
// nothing else touched; returns that stretch, or null when it isn't.
// Without this a suggestion could also turn "30 days" into "90 days"
// next to the blank it filled.
function replacedStretch(find: string, replaceWith: string, token: string): string | null {
  const at = replaceWith.indexOf(token);
  if (at === -1 || replaceWith.indexOf(token, at + 1) !== -1) return null;
  const before = replaceWith.slice(0, at);
  const after = replaceWith.slice(at + token.length);
  if (before.length + after.length >= find.length) return null;
  if (!find.startsWith(before) || !find.endsWith(after)) return null;
  const replaced = find.slice(before.length, find.length - after.length);
  if (!replaced.trim() || replaced.length > MAX_REPLACED_CHARS || replaced.includes("{{")) return null;
  return replaced;
}

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      find: z.string(),
      replaceWith: z.string(),
      key: z.string(),
    }),
  ),
});

const FIELD_LIST = MERGE_FIELDS.map((field) => `${field.key}: ${field.label} — ${field.description}`).join("\n");

const SYSTEM = `You place merge fields into a business's contract template. The template is plain text; a merge field is written {{key}} and is filled in with the customer's or the business's details when a contract is made.

The fields that exist (key: label — what it fills in with):
${FIELD_LIST}

Find each spot in the agreement where one of these values belongs: blanks to fill in (________, [Client Name], <date>, "XXXX"), and specific names, addresses, amounts or dates that clearly belong to one customer or one job and would change on the next contract. Do not touch the legal wording itself, and do not suggest a field for something that is the same on every contract.

For each spot return:
- find: an exact, verbatim snippet copied from the agreement, long enough to occur only once (include a few words of the surrounding line).
- replaceWith: that same snippet with only the blank or the specific value replaced by {{key}}.
- key: the field key used.

Only use keys from the list. If nothing fits, return an empty list.`;

const tooLongToCheck =
  "The suggestions came back cut short — the agreement may be too long to check in one go. Try again, or place the fields by hand.";

// Asks Claude where fields belong. Every suggestion is checked against the
// body before it is shown — a snippet that isn't there verbatim, isn't
// unique, names a field that doesn't exist, or changes anything besides
// the one blank it fills is dropped — and nothing is applied until the
// person ticks it.
export async function suggestFieldPlacements(body: string): Promise<{ suggestions: FieldSuggestion[] } | { error: string }> {
  if (!aiConfigured()) return { error: "Suggest fields isn't switched on for this site yet." };
  // ANTHROPIC_ENDPOINT points the browser suite at a stand-in, the same
  // way RESEND_ENDPOINT does for email; unset, the real API is used. One
  // retry and a 90-second wait keep the whole call inside the site's
  // five-minute limit on a request, so a slow answer comes back as a
  // message instead of a dead page.
  const client = new Anthropic({ baseURL: process.env.ANTHROPIC_ENDPOINT || undefined, timeout: 90_000, maxRetries: 1 });
  let parsed: z.infer<typeof suggestionSchema> | null = null;
  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: `<agreement>\n${body}\n</agreement>` }],
      output_config: { effort: "medium", format: betaZodOutputFormat(suggestionSchema) },
    });
    if (response.stop_reason === "refusal") return { error: "The suggestion service declined this one. Place the fields by hand." };
    if (response.stop_reason === "max_tokens") return { error: tooLongToCheck };
    parsed = response.parsed_output;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { error: "Too many requests just now. Try again in a minute." };
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return { error: "The suggestion service took too long. Try again, or place the fields by hand." };
    }
    if (error instanceof Anthropic.APIError) return { error: "The suggestion service didn't answer. Try again, or place the fields by hand." };
    // The answer came back but wasn't the list asked for: cut off on a
    // long agreement, or not JSON at all. The SDK raises its base error
    // for that, which is not an APIError.
    if (error instanceof Anthropic.AnthropicError) return { error: tooLongToCheck };
    console.error("[suggest-fields]", error);
    return { error: "Suggest fields hit a problem. Try again, or place the fields by hand." };
  }
  if (!parsed) return { error: "The suggestion came back unreadable. Try again." };

  const seen = new Set<string>();
  const suggestions: FieldSuggestion[] = [];
  for (const item of parsed.suggestions) {
    const field = mergeFieldFor(item.key);
    if (!field) continue;
    if (!item.find || seen.has(item.find)) continue;
    const first = body.indexOf(item.find);
    if (first === -1 || body.indexOf(item.find, first + 1) !== -1) continue;
    const replaced = replacedStretch(item.find, item.replaceWith, mergeToken(item.key));
    if (replaced === null) continue;
    seen.add(item.find);
    suggestions.push({ find: item.find, replaceWith: item.replaceWith, key: field.key, label: field.label, replaced });
  }
  return { suggestions };
}
