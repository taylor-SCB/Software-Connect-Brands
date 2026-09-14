"use client";

import { useActionState, useEffect, useState } from "react";
import { Card, CardHeader, FormError } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { saveProperty } from "./actions";

export type PropertyValues = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  companyId: string | null;
  contactId: string | null;
  notes: string;
};

type Choice = { id: string; name: string };

// A building. Only the name is required: a property can exist before
// anybody at it is in the CRM.
export function PropertyForm({
  property,
  companies,
  contacts,
  onDone,
}: {
  property?: PropertyValues;
  companies: Choice[];
  contacts: Choice[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveProperty, {});
  const id = (field: string) => `property-${property?.id ?? "new"}-${field}`;

  useEffect(() => {
    if (state.success && onDone) onDone();
  }, [state.success, onDone]);

  return (
    <form action={action} className="space-y-3" data-testid="property-form">
      {property && <input type="hidden" name="propertyId" value={property.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("name")}>
            What it is called
          </label>
          <input
            id={id("name")}
            name="name"
            defaultValue={property?.name}
            required
            maxLength={160}
            placeholder="Beachfront Lofts — Tower B"
            className="input"
            data-testid="property-name"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("address")}>
            Address<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("address")}
            name="address"
            defaultValue={property?.address ?? ""}
            maxLength={200}
            placeholder="1400 Harbor Blvd"
            className="input"
            data-testid="property-address"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={id("city")}>
            City<span className="faint font-normal"> · optional</span>
          </label>
          <input id={id("city")} name="city" defaultValue={property?.city ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={id("state")}>
            State<span className="faint font-normal"> · optional</span>
          </label>
          <input id={id("state")} name="state" defaultValue={property?.state ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={id("companyId")}>
            Who owns or manages it<span className="faint font-normal"> · optional</span>
          </label>
          <select
            id={id("companyId")}
            name="companyId"
            defaultValue={property?.companyId ?? ""}
            className="select"
            data-testid="property-company"
          >
            <option value="">Nobody yet</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id("contactId")}>
            Who you call<span className="faint font-normal"> · optional</span>
          </label>
          <select
            id={id("contactId")}
            name="contactId"
            defaultValue={property?.contactId ?? ""}
            className="select"
          >
            <option value="">Nobody in particular</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor={id("notes")}>
          Notes<span className="faint font-normal"> · optional</span>
        </label>
        <textarea
          id={id("notes")}
          name="notes"
          rows={2}
          defaultValue={property?.notes ?? ""}
          placeholder="Loading dock on the north side. Freight elevator booked through the front desk."
          className="textarea"
        />
      </div>

      <FormError message={state.error} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="property-save">
          {pending ? "Saving…" : property ? "Save changes" : "Add property"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function NewPropertyButton({ companies, contacts }: { companies: Choice[]; contacts: Choice[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary btn-sm"
        data-testid="new-property"
      >
        <IconPlus size={13} />
        New property
      </button>
    );
  }

  return (
    <Card lit>
      <CardHeader title="New property" subtitle="A building, with the jobs done at it." />
      <div className="p-5">
        <PropertyForm companies={companies} contacts={contacts} onDone={() => setOpen(false)} />
      </div>
    </Card>
  );
}
