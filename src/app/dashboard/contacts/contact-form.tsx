"use client";

import { useActionState } from "react";
import { Field, SelectField, FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/forms";

type ContactDefaults = {
  id?: string;
  company?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: string;
};

export function ContactForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: ContactDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4 p-5">
      {defaults.id && <input type="hidden" name="contactId" value={defaults.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Company name"
          name="company"
          placeholder="Sam's Diner"
          defaultValue={defaults.company ?? ""}
        />
        <Field
          label="Contact name"
          name="name"
          placeholder="Sam Rivera"
          defaultValue={defaults.name ?? ""}
          required
        />
        <Field
          label="Contact email"
          name="email"
          type="email"
          placeholder="sam@samsdiner.com"
          defaultValue={defaults.email ?? ""}
        />
        <Field
          label="Contact phone"
          name="phone"
          type="tel"
          placeholder="(555) 018-2200"
          defaultValue={defaults.phone ?? ""}
        />
        <Field
          label="Company website"
          name="website"
          placeholder="samsdiner.com"
          defaultValue={defaults.website ?? ""}
          hint="https:// is added automatically."
        />
        <SelectField
          label="Status"
          name="status"
          defaultValue={defaults.status ?? "LEAD"}
          options={[
            { value: "LEAD", label: "Lead" },
            { value: "CUSTOMER", label: "Customer" },
            { value: "ARCHIVED", label: "Archived" },
          ]}
        />
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
