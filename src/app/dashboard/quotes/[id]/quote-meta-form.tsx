"use client";

import { useActionState } from "react";
import {
  Field,
  SelectField,
  TextareaField,
  FormError,
  FormSuccess,
} from "@/components/ui";
import { updateQuoteMeta } from "../actions";
import type { ActionState } from "@/lib/forms";

export function QuoteMetaForm({
  quoteId,
  defaults,
}: {
  quoteId: string;
  defaults: {
    title: string;
    template: string;
    introNote: string;
    terms: string;
    validUntil: string;
  };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateQuoteMeta,
    {},
  );

  return (
    <form action={formAction} className="space-y-4 p-5">
      <input type="hidden" name="quoteId" value={quoteId} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Quote title" name="title" defaultValue={defaults.title} required />
        </div>
        <SelectField
          label="Template"
          name="template"
          defaultValue={defaults.template}
          options={[
            { value: "SIMPLE", label: "Simple" },
            { value: "MODERN", label: "Modern" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Valid until"
          name="validUntil"
          type="date"
          defaultValue={defaults.validUntil}
        />
      </div>

      <TextareaField
        label="Intro note"
        name="introNote"
        rows={3}
        placeholder="Thanks for having us out last week — here's the scope we discussed."
        defaultValue={defaults.introNote}
      />

      <TextareaField
        label="Terms"
        name="terms"
        rows={3}
        placeholder="50% deposit to schedule, balance on completion. Quote valid 30 days."
        defaultValue={defaults.terms}
      />

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
