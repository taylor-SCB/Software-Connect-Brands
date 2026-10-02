"use client";

import { useActionState, useState } from "react";
import { Field, SelectField, FormError, FormSuccess } from "@/components/ui";
import { CompanyPicker, type PickedCompany } from "@/components/company-picker";
import { IndustryPicker, type IndustryPickList } from "@/components/industry-picker";
import { ImageUploadField } from "@/components/image-upload-field";
import { ContactNameField } from "@/components/contact-name-field";
import type { ActionState } from "@/lib/forms";
import { CHANNEL_LABELS, CHANNEL_LABEL_NAMES, CONTACT_STATUS_LABELS, START_STATUSES } from "@/lib/constants";

type ContactDefaults = {
  id?: string;
  companyName?: string | null;
  // The company's current tags, when the contact already has one.
  company?: PickedCompany | null;
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  emailLabel?: string;
  email2?: string | null;
  email2Label?: string;
  phoneLabel?: string;
  phone2?: string | null;
  phone2Label?: string;
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
          defaultId={defaults.company?.id ?? null}
          onChange={(picked, text) => {
            setCompany(picked);
            setTyped(text);
          }}
        />
        {defaults.id ? (
          <Field
            label="Contact name"
            name="name"
            placeholder="Sam Rivera"
            defaultValue={defaults.name ?? ""}
            required
          />
        ) : (
          <ContactNameField
            defaultValue={defaults.name ?? ""}
            company={company ? { id: company.id, name: company.name } : null}
          />
        )}
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
        <ChannelField
          label="Contact email"
          name="email"
          type="email"
          placeholder="sam@samsdiner.com"
          defaultValue={defaults.email ?? ""}
          defaultLabel={defaults.emailLabel ?? "WORK"}
        />
        <ChannelField
          label="Contact phone"
          name="phone"
          type="tel"
          placeholder="(555) 018-2200"
          defaultValue={defaults.phone ?? ""}
          defaultLabel={defaults.phoneLabel ?? "WORK"}
        />
        <ChannelField
          label="Second email"
          name="email2"
          type="email"
          placeholder="sam.rivera@gmail.com"
          defaultValue={defaults.email2 ?? ""}
          defaultLabel={defaults.email2Label ?? "PERSONAL"}
        />
        <ChannelField
          label="Second phone"
          name="phone2"
          type="tel"
          placeholder="(555) 018-3300"
          defaultValue={defaults.phone2 ?? ""}
          defaultLabel={defaults.phone2Label ?? "PERSONAL"}
        />
        <Field
          label="Website"
          name="website"
          placeholder="samsdiner.com"
          defaultValue={defaults.website ?? ""}
          hint="https:// is added automatically."
        />
        {/* Status is chosen here only when the record is new; after that
            it is the status button on its page, which dates skipped steps. */}
        {!defaults.id && (
          <SelectField
            label="Status"
            name="status"
            defaultValue="NOT_ACTIONED"
            options={START_STATUSES.map((value) => ({ value, label: CONTACT_STATUS_LABELS[value] }))}
          />
        )}
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

// An email or phone box with its Personal / Work tag beside it. The tag
// posts as `<name>Label` (emailLabel, phone2Label...).
function ChannelField({
  label,
  name,
  type,
  placeholder,
  defaultValue,
  defaultLabel,
}: {
  label: string;
  name: string;
  type: string;
  placeholder: string;
  defaultValue: string;
  defaultLabel: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
        <span className="faint font-normal"> · optional</span>
      </label>
      <div className="flex gap-2">
        <input id={name} name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} className="input min-w-0 flex-1" />
        <select
          name={`${name}Label`}
          defaultValue={defaultLabel}
          aria-label={`${label}: Personal or Work`}
          className="select w-28 shrink-0"
          data-testid={`${name}-label`}
        >
          {CHANNEL_LABELS.map((value) => (
            <option key={value} value={value}>
              {CHANNEL_LABEL_NAMES[value]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
