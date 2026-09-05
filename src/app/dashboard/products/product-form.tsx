"use client";

import { useActionState } from "react";
import {
  Field,
  SelectField,
  TextareaField,
  FormError,
  FormSuccess,
} from "@/components/ui";
import { LINE_ITEM_TAGS, TAG_LABELS } from "@/lib/constants";
import { centsToDollarInput } from "@/lib/format";
import type { ActionState } from "@/lib/forms";

const TAG_OPTIONS = LINE_ITEM_TAGS.map((tag) => ({
  value: tag,
  label: TAG_LABELS[tag],
}));

export function ProductForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: {
    id?: string;
    name?: string;
    description?: string;
    sku?: string | null;
    unitPriceCents?: number;
    defaultTag?: string;
    active?: boolean;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const active = defaults?.active ?? true;

  return (
    <form action={formAction} className="space-y-4 p-5">
      {defaults?.id && <input type="hidden" name="productId" value={defaults.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Product name"
          name="name"
          placeholder="Journeyman labor — hourly"
          defaultValue={defaults?.name ?? ""}
          required
        />
        <Field
          label="SKU / code"
          name="sku"
          placeholder="LAB-JRN"
          defaultValue={defaults?.sku ?? ""}
        />
        <Field
          label="Unit price ($)"
          name="unitPrice"
          type="number"
          placeholder="125.00"
          defaultValue={
            defaults?.unitPriceCents !== undefined
              ? centsToDollarInput(defaults.unitPriceCents)
              : ""
          }
          hint="Used as the default value on quote line items."
        />
        <SelectField
          label="Default tag"
          name="defaultTag"
          options={TAG_OPTIONS}
          defaultValue={defaults?.defaultTag ?? "MATERIALS"}
          hint="Pre-selects the category on a quote line."
        />
      </div>

      <TextareaField
        label="Product description"
        name="description"
        rows={3}
        placeholder="Licensed journeyman labor, standard business hours."
        defaultValue={defaults?.description ?? ""}
        hint="Appears under the product name on quotes."
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={active}
          className="h-4 w-4 accent-[var(--brand)]"
        />
        Active — show this product when building quotes
      </label>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
