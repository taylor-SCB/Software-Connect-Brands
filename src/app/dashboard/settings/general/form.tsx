"use client";

import { useActionState } from "react";
import { Field, TextareaField, FormError, FormSuccess } from "@/components/ui";
import { ImageUploadField } from "@/components/image-upload-field";
import { updateCompanyInfo } from "../actions";
import type { ActionState } from "@/lib/forms";

export function CompanyInfoForm({
  organization,
  canEdit,
}: {
  organization: {
    name: string;
    logoUrl: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    description: string;
    history: string;
  };
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateCompanyInfo,
    {},
  );

  return (
    <form action={formAction} className="space-y-5 p-5">
      <ImageUploadField
        label="Logo"
        name="logo"
        currentUrl={organization.logoUrl}
        fallback={organization.name.charAt(0).toUpperCase()}
        disabled={!canEdit}
        hint="One logo for the whole workspace — changing it here changes Branding too."
      />

      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Street address" name="addressLine1" placeholder="123 Main St" defaultValue={organization.addressLine1 ?? ""} />
          <Field label="Suite / unit" name="addressLine2" placeholder="Suite 200" defaultValue={organization.addressLine2 ?? ""} />
          <Field label="City" name="city" placeholder="Austin" defaultValue={organization.city ?? ""} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" name="state" placeholder="TX" defaultValue={organization.state ?? ""} />
            <Field label="ZIP" name="postalCode" placeholder="78701" defaultValue={organization.postalCode ?? ""} />
          </div>
          <Field label="Company phone" name="phone" type="tel" placeholder="(555) 018-2200" defaultValue={organization.phone ?? ""} />
          <Field label="Company email" name="email" type="email" placeholder="office@yourcompany.com" defaultValue={organization.email ?? ""} />
          <Field
            label="Website"
            name="website"
            placeholder="yourcompany.com"
            defaultValue={organization.website ?? ""}
            hint="https:// is added automatically."
          />
        </div>

        <TextareaField
          label="About us"
          name="description"
          rows={4}
          placeholder="Who you are, what you do, who you do it for."
          defaultValue={organization.description}
          hint="Available on templates as the About Us merge field."
        />
        <TextareaField
          label="Company history"
          name="history"
          rows={4}
          placeholder="Founded in…"
          defaultValue={organization.history}
          hint="Available on templates as the Company History merge field."
        />
      </fieldset>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      {canEdit && (
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : "Save changes"}
        </button>
      )}
    </form>
  );
}
