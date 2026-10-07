import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MERGE_FIELDS, mergeFieldFor, mergeToken } from "@/lib/merge";

// Same cap as the other uploaded documents.
export const TEMPLATE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

// Turns an uploaded agreement into the plain text a template body holds.
// Word keeps its paragraphs; a PDF keeps its words but not its layout; a
// Google Doc comes in as the Word file Google downloads it as.
export async function extractAgreementText(file: File): Promise<{ text: string } | { error: string }> {
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > TEMPLATE_UPLOAD_MAX_BYTES) return { error: "Keep the file under 4 MB." };

  const name = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const pages = (await extractText(pdf, { mergePages: false })).text;
      text = pages.join("\n\n");
    } else if (name.endsWith(".txt")) {
      text = bytes.toString("utf8");
    } else if (name.endsWith(".doc")) {
      return { error: "That's the old Word format. Open it in Word and Save As .docx, then upload that." };
    } else {
      return { error: "Upload a Word (.docx), PDF or text file. For a Google Doc: File → Download → Microsoft Word." };
    }
  } catch {
    return { error: "That file couldn't be read. If it opens fine on your computer, save it again as .docx and retry." };
  }

  text = tidy(text);
  if (text.length < 20) {
    return {
      error: name.endsWith(".pdf")
        ? "This PDF has no readable text — it looks like a scan. Upload the Word version instead."
        : "There's almost no text in that file.",
    };
  }
  if (text.length > 60000) return { error: "That agreement is longer than a template can hold (60,000 characters)." };
  return { text };
}

// Word's extraction leaves runs of blank lines and stray spaces at line
// ends; three blank lines become one so the body reads like the original.
function tidy(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* --------------------------- Suggest fields --------------------------- */

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type FieldSuggestion = { find: string; replaceWith: string; key: string; label: string };

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

// Asks Claude where fields belong. Every suggestion is checked against the
// body before it is shown — a snippet that isn't there verbatim, isn't
// unique, or names a field that doesn't exist is dropped — and nothing is
// applied until the person ticks it.
export async function suggestFieldPlacements(body: string): Promise<{ suggestions: FieldSuggestion[] } | { error: string }> {
  if (!aiConfigured()) return { error: "Suggest fields isn't switched on for this site yet." };
  // ANTHROPIC_ENDPOINT points the browser suite at a stand-in, the same
  // way RESEND_ENDPOINT does for email; unset, the real API is used.
  const client = new Anthropic({ baseURL: process.env.ANTHROPIC_ENDPOINT || undefined });
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
    parsed = response.parsed_output;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { error: "Too many requests just now. Try again in a minute." };
    if (error instanceof Anthropic.APIError) return { error: "The suggestion service didn't answer. Try again, or place the fields by hand." };
    throw error;
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
    if (!item.replaceWith.includes(mergeToken(item.key)) || item.replaceWith === item.find) continue;
    seen.add(item.find);
    suggestions.push({ find: item.find, replaceWith: item.replaceWith, key: field.key, label: field.label });
  }
  return { suggestions };
}
