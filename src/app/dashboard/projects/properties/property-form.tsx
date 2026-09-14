"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader, FormError } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
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
  // What they are called, so the form can offer them even when the
  // picker's list no longer has them — archived, or past the cap on a
  // workspace with thousands of companies. Without this the <select>
  // fell back to "Nobody yet" and saving the address unlinked the owner.
  companyName?: string | null;
  contactName?: string | null;
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

  // Closes on a save that worked, and only then, so an error telling you
  // why nothing was saved stays on the screen. Keyed on the state object
  // rather than its message: saving twice reports the same words, and
  // comparing the words made the second save look already handled.
  const [handled, setHandled] = useState<ActionState | null>(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success && onDone) onDone();
  }

  // Whoever is linked now stays pickable whatever the list holds.
  const missingCompany =
    property?.companyId && !companies.some((entry) => entry.id === property.companyId)
      ? { id: property.companyId, name: `${property.companyName ?? "Linked company"} (archived)` }
      : null;
  const missingContact =
    property?.contactId && !contacts.some((entry) => entry.id === property.contactId)
      ? { id: property.contactId, name: `${property.contactName ?? "Linked contact"} (archived)` }
      : null;

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
            {missingCompany && <option value={missingCompany.id}>{missingCompany.name}</option>}
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
            {missingContact && <option value={missingContact.id}>{missingContact.name}</option>}
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
