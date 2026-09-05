"use client";

import { useActionState, useState } from "react";
import { Field, FormError } from "@/components/ui";
import { createQuote } from "../actions";
import type { ActionState } from "@/lib/forms";

const TEMPLATES = [
  {
    value: "SIMPLE",
    name: "Simple",
    blurb: "Clean, printable, black on white. Reads like a classic quotation.",
  },
  {
    value: "MODERN",
    name: "Modern",
    blurb: "Branded dark layout with a hero header and visual tag breakdown.",
  },
] as const;

export function NewQuoteForm({
  contacts,
  defaultContactId,
}: {
  contacts: { id: string; name: string; company: string | null }[];
  defaultContactId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createQuote,
    {},
  );
  const [template, setTemplate] = useState<string>("SIMPLE");

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

      <Field
        label="Quote title"
        name="title"
        placeholder="Kitchen remodel — phase 1"
        required
      />

      <div>
        <span className="label">Template</span>
        <input type="hidden" name="template" value={template} />
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((option) => {
            const selected = template === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTemplate(option.value)}
                aria-pressed={selected}
                className="card card-hover p-3 text-left"
                style={
                  selected
                    ? {
                        borderColor: "color-mix(in srgb, var(--brand) 55%, transparent)",
                        background: "color-mix(in srgb, var(--brand) 10%, transparent)",
                      }
                    : undefined
                }
              >
                <p className="text-sm font-semibold">{option.name}</p>
                <p className="faint mt-1 text-xs leading-relaxed">{option.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>

      <FormError message={state?.error} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Creating…" : "Create quote"}
      </button>
    </form>
  );
}
