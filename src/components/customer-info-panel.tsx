"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Field, FormError } from "@/components/ui";
import { DealPicker, type PickableDeal } from "@/components/deal-picker";
import { IconSignature } from "@/components/icons";
import type { ActionState } from "@/lib/forms";

export type PickableContact = { id: string; name: string; company: string | null };
export type PickableQuote = {
  id: string;
  number: number;
  title: string;
  dealId: string;
  status: string;
  // ISO string; the newest quote is the default pick.
  updatedAt: string;
};

export type CustomerSelection = {
  contactId: string;
  dealId: string;
  quoteId: string;
};

// The Customer Information column: who the contract is for, which deal and
// quote its numbers come from, and the button that generates it. Reports
// every change of selection upward so the preview can fetch real values.
export function CustomerInfoPanel({
  action,
  templateId,
  contacts,
  deals,
  quotes,
  defaults,
  onSelectionChange,
  disabledReason,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  // Missing until a template is saved; the panel then explains why
  // Generate is off instead of hiding it.
  templateId?: string;
  contacts: PickableContact[];
  deals: PickableDeal[];
  quotes: PickableQuote[];
  defaults?: Partial<CustomerSelection>;
  onSelectionChange?: (selection: CustomerSelection) => void;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [contactId, setContactId] = useState(defaults?.contactId ?? "");
  const [dealId, setDealId] = useState(defaults?.dealId ?? "");
  // The user's explicit quote pick; the effective quote is derived below so
  // switching deals never leaves a quote from the old deal selected.
  const [quoteChoice, setQuoteChoice] = useState(defaults?.quoteId ?? "");

  // Quotes on the picked deal, newest first, so the default is the one
  // most recently worked on — same as the pipeline reads the value from.
  const dealQuotes = useMemo(
    () =>
      quotes
        .filter((quote) => quote.dealId === dealId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [quotes, dealId],
  );

  // Default to the deal's primary quote: accepted, else the latest one the
  // customer hasn't declined, else the newest.
  const quoteId = dealQuotes.some((quote) => quote.id === quoteChoice)
    ? quoteChoice
    : (
        dealQuotes.find((quote) => quote.status === "ACCEPTED") ??
        dealQuotes.find((quote) => quote.status !== "DECLINED") ??
        dealQuotes[0]
      )?.id ?? "";

  useEffect(() => {
    onSelectionChange?.({ contactId, dealId, quoteId });
  }, [contactId, dealId, quoteId, onSelectionChange]);

  const contact = contacts.find((c) => c.id === contactId);

  return (
    <form action={formAction} className="space-y-4">
      {templateId && <input type="hidden" name="templateId" value={templateId} />}

      <div>
        <label className="label" htmlFor="contactId">
          Customer
        </label>
        <select
          id="contactId"
          name="contactId"
          value={contactId}
          onChange={(event) => {
            setContactId(event.target.value);
            setDealId("");
          }}
          required
          className="select"
        >
          <option value="" disabled>
            Select a customer…
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company ? `${c.company} — ${c.name}` : c.name}
            </option>
          ))}
        </select>
        {contact?.company && (
          <p className="faint mt-1 text-xs">
            {contact.name} at {contact.company}
          </p>
        )}
      </div>

      {/* Keyed on the customer so a switch clears the deal box. */}
      <DealPicker
        key={contactId}
        deals={deals}
        contactId={contactId}
        required={false}
        defaultDealId={defaults?.dealId}
        onPick={setDealId}
      />

      <div>
        <label className="label" htmlFor="quoteId">
          Quote
          <span className="faint font-normal"> · optional</span>
        </label>
        <select
          id="quoteId"
          name="quoteId"
          value={quoteId}
          onChange={(event) => setQuoteChoice(event.target.value)}
          disabled={dealQuotes.length === 0}
          className="select"
        >
          {dealQuotes.length === 0 ? (
            <option value="">
              {dealId ? "No quotes on this deal yet" : "Pick a deal to choose its quote"}
            </option>
          ) : (
            dealQuotes.map((quote) => (
              <option key={quote.id} value={quote.id}>
                QUO-{quote.number} · {quote.title} · {statusLabel(quote.status)}
              </option>
            ))
          )}
        </select>
        <p className="faint mt-1 text-xs">
          Quote and product fields fill in from this quote.
        </p>
      </div>

      <Field
        label="Contract title"
        name="title"
        placeholder="Leave blank to use the template name"
      />

      <FormError message={state?.error} />

      <button
        type="submit"
        disabled={pending || !templateId || Boolean(disabledReason)}
        className="btn btn-primary w-full"
        title={disabledReason}
      >
        <IconSignature size={14} />
        {pending ? "Generating…" : "Generate contract"}
      </button>
      {!templateId && (
        <p className="faint text-center text-xs">Save the template first, then generate from it here.</p>
      )}
      {disabledReason && <p className="faint text-center text-xs">{disabledReason}</p>}
    </form>
  );
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
