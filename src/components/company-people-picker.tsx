"use client";

import { useState, useTransition } from "react";
import { IconCheck, IconPlus, IconSearch, IconX } from "@/components/icons";
import { useSearch } from "@/lib/use-search";
import { quickAddContactToCompany } from "@/app/dashboard/contacts/account-actions";

export type CompanyPerson = { id: string; name: string; email: string | null; phone: string | null };

// Who the activity was with, on a company page. The company's first
// people are offered as ticks; the box searches the rest of them (its
// own and anyone linked to it); "+ Add new contact" makes one on the
// spot and ticks them. Every tick posts as `extraContactIds`, and the
// entry is logged on each of them. Nobody ticked: it goes on the company.
export function CompanyPeoplePicker({ companyId, people }: { companyId: string; people: CompanyPerson[] }) {
  const [picked, setPicked] = useState<Map<string, CompanyPerson>>(new Map());
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "" });
  const [made, setMade] = useState<CompanyPerson[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const q = query.trim();
  const { results } = useSearch<CompanyPerson>(q ? `/dashboard/contacts/search?companyId=${companyId}&q=${encodeURIComponent(q)}` : null);
  const shown = q ? results : [...made, ...people.filter((person) => !made.some((m) => m.id === person.id))].slice(0, 12);

  function toggle(person: CompanyPerson) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(person.id)) next.delete(person.id);
      else next.set(person.id, person);
      return next;
    });
  }

  function addNew() {
    setError(undefined);
    start(async () => {
      const result = await quickAddContactToCompany({ companyId, ...draft });
      if (result.error || !result.contact) {
        setError(result.error ?? "Couldn't add that contact");
        return;
      }
      const person = result.contact;
      setMade((prev) => [person, ...prev]);
      setPicked((prev) => new Map(prev).set(person.id, person));
      setDraft({ name: "", email: "", phone: "" });
      setAdding(false);
      setQuery("");
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] p-2.5" data-testid="company-people-picker">
      {Array.from(picked.keys()).map((id) => (
        <input key={id} type="hidden" name="extraContactIds" value={id} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="faint text-xs">
          {picked.size === 0 ? "With whom? Tick people, or leave it on the company." : `Logged on ${picked.size} ${picked.size === 1 ? "person" : "people"}`}
        </p>
        <div className="relative">
          <IconSearch size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find someone here…"
            aria-label="Find someone at this company"
            className="input input-sm w-48 pl-7"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[...Array.from(picked.values()).filter((p) => !shown.some((s) => s.id === p.id)), ...shown].map((person) => {
          const on = picked.has(person.id);
          return (
            <button
              key={person.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(person)}
              title={[person.email, person.phone].filter(Boolean).join(" · ") || undefined}
              className={`badge cursor-pointer gap-1 border transition-colors ${
                on
                  ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_22%,transparent)] text-[var(--text)]"
                  : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-strong)]"
              }`}
              data-testid="company-person-chip"
            >
              {on && <IconCheck size={10} />}
              {person.name}
            </button>
          );
        })}
        {q && results.length === 0 && <span className="faint text-xs">Nobody here by that name.</span>}
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setDraft({ name: q, email: "", phone: "" });
              setAdding(true);
            }}
            className="btn btn-ghost btn-sm"
            data-testid="company-person-add"
          >
            <IconPlus size={11} />
            Add New Contact
          </button>
        )}
      </div>

      {adding && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto_auto]" data-testid="company-person-new">
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Name"
            aria-label="New contact name"
            maxLength={120}
            autoFocus
            onKeyDown={(event) => {
              // Enter adds the person; it must not send the activity form.
              if (event.key === "Enter") {
                event.preventDefault();
                if (draft.name.trim()) addNew();
              }
            }}
            className="input input-sm"
          />
          <input
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            placeholder="Email · optional"
            aria-label="New contact email"
            type="email"
            className="input input-sm"
          />
          <input
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            placeholder="Phone · optional"
            aria-label="New contact phone"
            type="tel"
            className="input input-sm"
          />
          <button type="button" onClick={addNew} disabled={pending || !draft.name.trim()} className="btn btn-primary btn-sm" data-testid="company-person-save">
            {pending ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => setAdding(false)} aria-label="Cancel new contact" className="btn btn-ghost btn-sm">
            <IconX size={12} />
          </button>
        </div>
      )}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
