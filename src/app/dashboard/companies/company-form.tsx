"use client";

import { useActionState } from "react";
import { Field, SelectField, FormError, FormSuccess } from "@/components/ui";
import { ImageUploadField } from "@/components/image-upload-field";
import type { ActionState } from "@/lib/forms";

type CompanyDefaults = {
  id?: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  logoUrl?: string | null;
  status?: string;
};

export function CompanyForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: CompanyDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4 p-5">
      {defaults.id && <input type="hidden" name="companyId" value={defaults.id} />}

      <ImageUploadField
        label="Logo"
        name="logo"
        currentUrl={defaults.logoUrl ?? null}
        fallback={(defaults.name ?? "?").charAt(0).toUpperCase()}
        hint="Shown on the deal tracker and on documents addressed to this company."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Company name"
          name="name"
          placeholder="Sam's Diner"
          defaultValue={defaults.name ?? ""}
          required
        />
        <Field
          label="Main phone"
          name="phone"
          type="tel"
          placeholder="(555) 018-2200"
          defaultValue={defaults.phone ?? ""}
        />
        <Field
          label="Main email"
          name="email"
          type="email"
          placeholder="office@samsdiner.com"
          defaultValue={defaults.email ?? ""}
        />
        <Field
          label="Website"
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
        <div className="hidden sm:block" />
        <Field label="City" name="city" placeholder="Austin" defaultValue={defaults.city ?? ""} />
        <Field label="State" name="state" placeholder="TX" defaultValue={defaults.state ?? ""} />
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
