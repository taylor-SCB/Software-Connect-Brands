"use client";

import { useActionState, useState } from "react";
import { Field, TextareaField, FormError, FormSuccess } from "@/components/ui";
import { ImageUploadField } from "@/components/image-upload-field";
import { PAYMENT_TERM_OPTIONS, SCHEDULE_PRESETS, SCHEDULE_PRESET_LABELS } from "@/lib/payments";
import { updateCompanyInfo } from "../actions";
import type { ActionState } from "@/lib/forms";

// Your standard payment table. A new contract starts with these terms
// and rows, on the Deal Tracker and the New contract page; the dates and
// amounts can still be changed on any contract afterwards.
function PaymentTablePreset({
  organization,
}: {
  organization: {
    defaultPaymentTerms: string;
    defaultPaymentPreset: string;
    defaultDepositPercent: number;
    defaultInstallmentCount: number;
    paymentInstructions: string;
  };
}) {
  const [preset, setPreset] = useState(organization.defaultPaymentPreset);
  return (
    <div className="space-y-4 border-t border-[rgb(255_255_255/0.06)] pt-5">
      <div>
        <h3 className="text-sm font-semibold">Payment table</h3>
        <p className="muted text-sm">
          What a new contract&apos;s payments start as. You can change the dates and amounts on any contract later.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="defaultPaymentTerms">Payment terms</label>
          <select
            id="defaultPaymentTerms"
            name="defaultPaymentTerms"
            className="select"
            defaultValue={organization.defaultPaymentTerms}
            data-testid="preset-terms"
          >
            {PAYMENT_TERM_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="defaultPaymentPreset">Payments</label>
          <select
            id="defaultPaymentPreset"
            name="defaultPaymentPreset"
            className="select"
            value={preset}
            onChange={(event) => setPreset(event.target.value)}
            data-testid="preset-kind"
          >
            {SCHEDULE_PRESETS.map((option) => (
              <option key={option} value={option}>{SCHEDULE_PRESET_LABELS[option]}</option>
            ))}
          </select>
        </div>
        {preset === "DEPOSIT_BALANCE" && (
          <div>
            <label className="label" htmlFor="defaultDepositPercent">Deposit %</label>
            <input
              id="defaultDepositPercent"
              name="defaultDepositPercent"
              type="number"
              min={1}
              max={99}
              className="input num"
              defaultValue={organization.defaultDepositPercent}
              data-testid="preset-deposit"
            />
          </div>
        )}
        {preset === "INSTALLMENTS" && (
          <div>
            <label className="label" htmlFor="defaultInstallmentCount">How many payments</label>
            <input
              id="defaultInstallmentCount"
              name="defaultInstallmentCount"
              type="number"
              min={2}
              max={60}
              className="input num"
              defaultValue={organization.defaultInstallmentCount}
              data-testid="preset-installments"
            />
          </div>
        )}
      </div>
      <div>
        <label className="label" htmlFor="paymentInstructions">
          How to pay you
          <span className="faint font-normal"> · optional</span>
        </label>
        <textarea
          id="paymentInstructions"
          name="paymentInstructions"
          rows={3}
          defaultValue={organization.paymentInstructions}
          placeholder={"Checks to Acme LLC, 12 Main St, Austin TX 78701\nZelle: pay@acmeservices.com"}
          className="input w-full"
          data-testid="payment-instructions"
        />
        <p className="faint mt-1 text-xs">
          Printed on every invoice a customer opens. Nothing here takes card payments yet.
        </p>
      </div>
    </div>
  );
}

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
    defaultPaymentTerms: string;
    defaultPaymentPreset: string;
    defaultDepositPercent: number;
    defaultInstallmentCount: number;
    paymentInstructions: string;
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

        <PaymentTablePreset organization={organization} />
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
