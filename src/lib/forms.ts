import type { z } from "zod";

export type ActionState = { error?: string; success?: string };

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
