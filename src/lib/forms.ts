import type { z } from "zod";

// `kept` is what the person had typed, handed back with an error so the
// form can put it straight back on the screen. React resets a form whose
// action is a server function — including when that function refuses —
// so without this a rejected save emptied every box and the reason for
// the refusal was the only thing left.
export type ActionState = { error?: string; success?: string; kept?: Record<string, string> };

// Snapshots the text fields of a submitted form, for handing back with
// an error. Only strings: a file cannot be put back in an input anyway.
export function keepFields(formData: FormData, names: readonly string[]): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string" && value !== "") kept[name] = value;
  }
  return kept;
}

// Every server action funnels form parsing through here so a missing or
// malformed field becomes a readable message instead of a 500 from a
// Prisma call with `undefined` in the where clause.
export function parseForm<T extends z.ZodType>(
  schema: T,
  input: Record<string, unknown>,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }
  return { ok: true, data: parsed.data };
}

// Optional free-text field: trims, and turns "" into null for the database
// so we never store empty strings that then render as blank-but-present.
export function optionalText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
