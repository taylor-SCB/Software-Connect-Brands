"use client";

import { useActionState } from "react";
import { Field, FormError } from "@/components/ui";
import { createContract } from "../actions";
import { CONTRACT_TYPE_LABELS, type ContractTypeValue } from "@/lib/constants";
import type { ActionState } from "@/lib/forms";

export function NewContractForm({
  contacts,
  templates,
  defaultContactId,
  defaultTemplateId,
}: {
  contacts: { id: string; name: string; company: string | null }[];
  templates: { id: string; name: string; description: string; type: string }[];
  defaultContactId?: string;
  defaultTemplateId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createContract,
    {},
  );

  return (
    <form action={formAction} className="space-y-5 p-5">
      <div>
        <label className="label" htmlFor="contactId">
          Customer
        </label>
        <select
          id="contactId"
          name="contactId"
          defaultValue={defaultContactId ?? ""}
          required
          className="select"
        >
          <option value="" disabled>
            Select a contact…
          </option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.company ? `${contact.company} — ${contact.name}` : contact.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="templateId">
          Template
        </label>
        <select
          id="templateId"
          name="templateId"
          defaultValue={defaultTemplateId ?? templates[0]?.id ?? ""}
          required
          className="select"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ·{" "}
              {CONTRACT_TYPE_LABELS[template.type as ContractTypeValue]}
            </option>
          ))}
        </select>
      </div>

      <Field
        label="Contract title"
        name="title"
        placeholder="Leave blank to use the template name"
      />

      <FormError message={state?.error} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Generating…" : "Generate contract"}
      </button>
    </form>
  );
}
