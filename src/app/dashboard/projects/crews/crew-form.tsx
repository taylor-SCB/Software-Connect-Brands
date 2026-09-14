"use client";

import { useActionState, useState } from "react";
import { centsToDollarInput } from "@/lib/format";
import { CREW_KINDS, CREW_KIND_LABELS, CREW_KIND_HINTS } from "@/lib/crews";
import { FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/forms";
import { saveCrew } from "./actions";

export type CrewValues = {
  id: string;
  name: string;
  kind: string;
  companyId: string | null;
  contactId: string | null;
  serviceTypes: string[];
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  phone: string | null;
  email: string | null;
  notes: string;
};

type Choice = { id: string; name: string };

// One form builds a crew and edits one. The kind comes first because it
// decides everything else on the screen: your own people cost you their
// hours, a subcontractor bills you.
export function CrewForm({
  crew,
  companies,
  contacts,
  serviceTypes,
  onDone,
}: {
  crew?: CrewValues;
  companies: Choice[];
  contacts: Choice[];
  serviceTypes: string[];
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveCrew, {});
  const [kind, setKind] = useState(crew?.kind ?? "OWN");
  const [picked, setPicked] = useState<string[]>(crew?.serviceTypes ?? []);
  const id = (field: string) => `crew-${crew?.id ?? "new"}-${field}`;
  const subcontractor = kind === "SUBCONTRACTOR";

  // Closes on a save that worked, and only then, so an error telling you
  // why nothing was saved stays on the screen. Keyed on the state object
  // rather than its message: saving twice reports the same words, and
  // comparing the words made the second save look already handled.
  const [handled, setHandled] = useState<ActionState | null>(state);
  if (state !== handled) {
    setHandled(state);
    if (state.success && onDone) onDone();
  }

  const toggle = (name: string) =>
    setPicked((current) =>
      current.includes(name) ? current.filter((value) => value !== name) : [...current, name],
    );

  return (
    <form action={action} className="space-y-3" data-testid="crew-form">
      {crew && <input type="hidden" name="crewId" value={crew.id} />}
      {picked.map((name) => (
        <input key={name} type="hidden" name="serviceTypes" value={name} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("name")}>
            Crew name
          </label>
          <input
            id={id("name")}
            name="name"
            defaultValue={crew?.name}
            required
            maxLength={80}
            placeholder={subcontractor ? "Ridgeline Roofing" : "Install Team A"}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("kind")}>
            Who they are
          </label>
          <select
            id={id("kind")}
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="select"
          >
            {CREW_KINDS.map((value) => (
              <option key={value} value={value}>
                {CREW_KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="faint mt-1 text-xs" data-testid="crew-kind-hint">
            {CREW_KIND_HINTS[kind as "OWN" | "SUBCONTRACTOR"]}
          </p>
        </div>
      </div>

      {subcontractor && (
        <div>
          <label className="label" htmlFor={id("companyId")}>
            The company that bills you
            <span className="faint font-normal"> · optional</span>
          </label>
          <select id={id("companyId")} name="companyId" defaultValue={crew?.companyId ?? ""} className="select">
            <option value="">Not linked to a company yet</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <p className="faint mt-1 text-xs">
            Linking them means what you owe them reads on their own page alongside everything else.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={id("hourlyRate")}>
            Hourly rate
            <span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("hourlyRate")}
            name="hourlyRate"
            inputMode="decimal"
            defaultValue={crew?.hourlyRateCents ? centsToDollarInput(crew.hourlyRateCents) : ""}
            placeholder="45.00"
            className="input num"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("dailyRate")}>
            Day rate
            <span className="faint font-normal"> · optional</span>
          </label>
          <input
            id={id("dailyRate")}
            name="dailyRate"
            inputMode="decimal"
            defaultValue={crew?.dailyRateCents ? centsToDollarInput(crew.dailyRateCents) : ""}
            placeholder="520.00"
            className="input num"
          />
        </div>
        <div>
          <label className="label" htmlFor={id("contactId")}>
            Who you call
            <span className="faint font-normal"> · optional</span>
          </label>
          <select id={id("contactId")} name="contactId" defaultValue={crew?.contactId ?? ""} className="select">
            <option value="">Nobody in particular</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="faint text-xs">
        One rate is enough. A crew with both can be logged either way — three days plus four hours of overtime is
        one entry.
      </p>

      <div>
        <p className="label">
          What they do<span className="faint font-normal"> · optional</span>
        </p>
        <div className="flex flex-wrap gap-1.5" data-testid="crew-service-types">
          {serviceTypes.map((name) => {
            const on = picked.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                aria-pressed={on}
                className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
              >
                {name}
              </button>
            );
          })}
        </div>
        <p className="faint mt-1 text-xs">
          A scope of work suggests the crews that do that kind of work first.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("phone")}>
            Phone<span className="faint font-normal"> · optional</span>
          </label>
          <input id={id("phone")} name="phone" defaultValue={crew?.phone ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={id("email")}>
            Email<span className="faint font-normal"> · optional</span>
          </label>
          <input id={id("email")} name="email" defaultValue={crew?.email ?? ""} className="input" />
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
          defaultValue={crew?.notes ?? ""}
          placeholder="Two trucks, own lift. Insurance expires in March."
          className="textarea"
        />
      </div>

      <FormError message={state.error} />
      <FormSuccess message={state.success} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="crew-save">
          {pending ? "Saving…" : crew ? "Save changes" : "Add crew"}
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
