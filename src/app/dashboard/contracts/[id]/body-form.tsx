"use client";

import { useActionState } from "react";
import { Field, TextareaField, FormError, FormSuccess } from "@/components/ui";
import { updateContractBody } from "../actions";
import type { ActionState } from "@/lib/forms";

export function ContractBodyForm({
  contractId,
  title,
  body,
  locked,
}: {
  contractId: string;
  title: string;
  body: string;
  locked: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateContractBody,
    {},
  );

  if (locked) {
    return (
      <div className="p-5">
        <p className="mb-3 text-sm font-semibold">{title}</p>
        <pre className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4 font-sans text-xs leading-relaxed text-[var(--text-dim)]">
          {body}
        </pre>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 p-5">
      <input type="hidden" name="contractId" value={contractId} />
      <Field label="Contract title" name="title" defaultValue={title} required />
      <TextareaField label="Body" name="body" rows={24} defaultValue={body} required />

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : "Save contract"}
      </button>
    </form>
  );
}
