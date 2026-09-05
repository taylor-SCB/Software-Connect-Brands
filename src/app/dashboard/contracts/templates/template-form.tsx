"use client";

import { useActionState } from "react";
import {
  Field,
  SelectField,
  TextareaField,
  FormError,
  FormSuccess,
} from "@/components/ui";
import { MERGE_FIELDS } from "@/lib/merge";
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/forms";

export function TemplateForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: {
    id?: string;
    name?: string;
    type?: string;
    description?: string;
    body?: string;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4 p-5">
      {defaults?.id && <input type="hidden" name="templateId" value={defaults.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Template name"
          name="name"
          placeholder="Service Agreement"
          defaultValue={defaults?.name ?? ""}
          required
        />
        <SelectField
          label="Type"
          name="type"
          defaultValue={defaults?.type ?? "CUSTOM"}
          options={CONTRACT_TYPES.map((type) => ({
            value: type,
            label: CONTRACT_TYPE_LABELS[type],
          }))}
        />
      </div>

      <Field
        label="Description"
        name="description"
        placeholder="Master agreement for a new engagement."
        defaultValue={defaults?.description ?? ""}
      />

      <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
        <p className="eyebrow mb-2">Merge fields</p>
        <div className="flex flex-wrap gap-1.5">
          {MERGE_FIELDS.map((field) => (
            <span
              key={field.token}
              title={field.description}
              className="num rounded border border-[var(--border)] px-1.5 py-0.5 text-[0.7rem] text-[var(--text-dim)]"
            >
              {field.token}
            </span>
          ))}
        </div>
        <p className="faint mt-2 text-xs">
          These are replaced with the customer&apos;s details when a contract is
          generated from this template.
        </p>
      </div>

      <TextareaField
        label="Body"
        name="body"
        rows={22}
        defaultValue={defaults?.body ?? ""}
        required
      />

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
