"use client";

import { useActionState, useEffect } from "react";
import { Field, TextareaField, FormError, FormSuccess } from "@/components/ui";
import { updateContractBody, setContractStatus } from "../actions";
import type { ActionState } from "@/lib/forms";
import { useRedlineDraft } from "./redline-draft";

export function ContractBodyForm({
  contractId,
  title,
  body,
  locked,
  sent = false,
}: {
  contractId: string;
  title: string;
  body: string;
  locked: boolean;
  // Out for signature: read-only, with "Pull back to draft to edit".
  sent?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateContractBody,
    {},
  );
  // Changes accepted from the customer's marked-up copy (Release B) wait
  // here until Save; a save that goes through lets them go.
  const { draft, clearDraft } = useRedlineDraft();
  useEffect(() => {
    if (state?.success) clearDraft();
    // Each save hands back a new state object, so two saves in a row both
    // count (comparing the message would not).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (locked || sent) {
    return (
      <div className="p-5" data-testid={sent ? "contract-body-sent" : "contract-body-locked"}>
        {sent && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--tint-1)] px-3 py-2">
            <p className="muted text-xs">Out for signature, so the wording is locked: the customer signs what they read.</p>
            <form action={setContractStatus}>
              <input type="hidden" name="contractId" value={contractId} />
              <input type="hidden" name="status" value="DRAFT" />
              <button type="submit" className="btn btn-ghost btn-sm" data-testid="pull-back-to-edit">
                Pull back to draft to edit
              </button>
            </form>
          </div>
        )}
        <p className="mb-3 text-sm font-semibold">{title}</p>
        <pre className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--tint-1)] p-4 font-sans text-xs leading-relaxed text-[var(--text-dim)]">
          {body}
        </pre>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 p-5">
      <input type="hidden" name="contractId" value={contractId} />
      <Field label="Contract title" name="title" defaultValue={title} required />
      {draft && (
        <p
          role="status"
          className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--text-strong)]"
          data-testid="redline-draft-note"
        >
          {draft.applied === 1 ? "One change" : `${draft.applied} changes`} from their marked-up copy {draft.applied === 1 ? "is" : "are"} in the body below. Nothing is saved until Save changes.
        </p>
      )}
      <div key={draft?.version ?? 0}>
        <TextareaField label="Body" name="body" rows={24} defaultValue={draft?.body ?? body} required />
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
