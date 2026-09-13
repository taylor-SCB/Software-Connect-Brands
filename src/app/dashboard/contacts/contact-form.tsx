"use client";

import { useActionState, useState } from "react";
import { Field, SelectField, FormError, FormSuccess } from "@/components/ui";
import { CompanyPicker, type PickedCompany } from "@/components/company-picker";
import { IndustryPicker, type IndustryPickList } from "@/components/industry-picker";
import { ImageUploadField } from "@/components/image-upload-field";
import type { ActionState } from "@/lib/forms";

type ContactDefaults = {
  id?: string;
  companyName?: string | null;
  // The company's current tags, when the contact already has one.
  company?: PickedCompany | null;
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  birthday?: string | null;
  imageUrl?: string | null;
  status?: string;
};

export function ContactForm({
  action,
  pickList,
  defaults = {},
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  pickList: IndustryPickList;
  defaults?: ContactDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  // Which company the Company box currently names: an existing one (its
  // tags load into the picker), a new name (blank picker), or nothing
  // (Individual / Personal, nothing to pick).
  const [company, setCompany] = useState<PickedCompany | null>(defaults.company ?? null);
  const [typed, setTyped] = useState(defaults.companyName ?? "");
  const pickerKey = company ? company.id : typed.trim() ? "new" : "none";

  return (
    <form action={formAction} className="space-y-4 p-5">
      {defaults.id && <input type="hidden" name="contactId" value={defaults.id} />}

      <ImageUploadField
        label="Photo or icon"
        name="image"
        currentUrl={defaults.imageUrl ?? null}
        fallback={(defaults.name ?? "?").charAt(0).toUpperCase()}
        shape="round"
        hint="Shown on their page and on the deal tracker."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <CompanyPicker
          defaultName={defaults.companyName ?? ""}
          onChange={(picked, text) => {
            setCompany(picked);
            setTyped(text);
          }}
        />
        <Field
          label="Contact name"
          name="name"
          placeholder="Sam Rivera"
          defaultValue={defaults.name ?? ""}
          required
        />
        <IndustryPicker
          key={pickerKey}
          pickList={pickList}
          defaultIndustries={company?.industries ?? []}
          defaultTypes={company?.companyTypes ?? []}
          disabled={!typed.trim()}
          disabledReason="No company on this contact, so they count as a person, not a business. Type a company above to tag one."
        />
        <Field
          label="Title"
          name="title"
          placeholder="Owner, Office Manager, Foreman"
          defaultValue={defaults.title ?? ""}
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
        <Field
          label="Birthday"
          name="birthday"
          type="date"
          defaultValue={defaults.birthday ?? ""}
          hint="Worth knowing. A reminder can be built on it later."
        />
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
