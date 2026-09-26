import { z } from "zod";

// What a payment schedule and a discount look like when they arrive from
// a screen that is describing a contract before it exists: the Contract
// Coordinator's cards and "Award without paperwork". Shared so both
// server actions accept exactly the same shape.

// One row of a schedule written before the contract exists. The same
// shape the saved table uses, without the ids.
export const newScheduleRowSchema = z.object({
  label: z.string().trim().min(1, "Every payment needs a label").max(120),
  kind: z.enum(["PERCENT", "FIXED", "BALANCE"]),
  percent: z.number().min(0).max(100).nullable(),
  fixedCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A due date isn't valid")]),
  terms: z.string().trim().max(60).nullable().optional(),
});

export type NewScheduleRow = z.infer<typeof newScheduleRowSchema>;

// A discount as typed: a percent (kept, so the screens can say "10% off")
// or a fixed number of cents. Resolved against the real subtotal on the
// server, never trusted as a finished amount from the browser.
export const discountInputSchema = z.object({
  percent: z.number().min(0).max(100).nullable(),
  cents: z.number().int().min(0).max(1_000_000_000),
});

export type DiscountInputValue = z.infer<typeof discountInputSchema>;
