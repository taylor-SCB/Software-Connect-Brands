"use client";

import { useState, useTransition } from "react";
import { IconCheck, IconPlus, IconSearch, IconX } from "@/components/icons";
import { useSearch } from "@/lib/use-search";
import { quickAddContactToCompany } from "@/app/dashboard/contacts/account-actions";

export type CompanyPerson = { id: string; name: string; email: string | null; phone: string | null };

// Who the activity was with, on a company page ("Who?" first in How did
// it go?, Nov 11, 2026). The company's first people are offered as chips;
// the box searches the rest of them (its own and anyone linked to it);
// "+ Add new contact" makes one on the spot and ticks them. Every tick
// posts as `extraContactIds`, and the entry is logged on each of them.
// Nobody ticked is refused (Oct 4, 2026) unless the "Front desk / main
// line" chip is on — it replaced the "I'm choosing not to link a contact"
// box with the same behaviour (`bypass=1`): the entry sits on the company
// under "<you> Bypassed" in Other Contacts until somebody claims it.
// Picking a person turns Front desk off, and Front desk unticks people.
export function CompanyPeoplePicker({
  companyId,
  people,
  userName,
  initial,
  onChange,
}: {
  companyId: string;
  people: CompanyPerson[];
  // Whoever is logging, for the line saying what a bypass will read as.
  userName?: string;
  // People ticked to start with (a tel: tap on their row).
  initial?: string[];
  // Every change: who is ticked, and whether Front desk is on.
  onChange?: (ids: string[], frontDesk: boolean) => void;
}) {
  const [picked, setPicked] = useState<Map<string, CompanyPerson>>(
    () => new Map(people.filter((person) => initial?.includes(person.id)).map((person) => [person.id, person])),
  );
  const [bypass, setBypass] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "" });
  const [made, setMade] = useState<CompanyPerson[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const q = query.trim();
  const { results } = useSearch<CompanyPerson>(q ? `/dashboard/contacts/search?companyId=${companyId}&q=${encodeURIComponent(q)}` : null);
  const shown = q ? results : [...made, ...people.filter((person) => !made.some((m) => m.id === person.id))].slice(0, 12);

  function update(next: Map<string, CompanyPerson>, desk: boolean) {
    setPicked(next);
    setBypass(desk);
    onChange?.(Array.from(next.keys()), desk);
  }

  function toggle(person: CompanyPerson) {
    const next = new Map(picked);
    if (next.has(person.id)) next.delete(person.id);
    else next.set(person.id, person);
    // Ticking a person is the opposite of the front desk.
    update(next, false);
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
      update(new Map(picked).set(person.id, person), false);
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
      {bypass && <input type="hidden" name="bypass" value="1" />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="faint text-xs">
          {picked.size === 0
            ? bypass
              ? "Logged on the company, nobody linked."
              : "Tap who it was with."
            : `Logged on ${picked.size} ${picked.size === 1 ? "person" : "people"}`}
        </p>
        <div className="relative">
          <IconSearch size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find someone here…"
            aria-label="Find someone at this company"
            className="input input-sm w-full min-w-0 pl-7 sm:w-48"
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
              className={`badge min-h-11 cursor-pointer gap-1 border transition-colors sm:min-h-0 ${
                on
                  ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_22%,transparent)] text-[var(--text)]"
                  : "border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-strong)]"
              }`}
              data-testid="company-person-chip"
            >
              {on && <IconCheck size={10} />}
              {person.name}
            </button>
          );
        })}
        {q && results.length === 0 && <span className="faint text-xs">Nobody here by that name.</span>}
        <span className="contents" data-testid="company-bypass">
          <button
            type="button"
            role="checkbox"
            aria-checked={bypass}
            onClick={() => update(new Map(), !bypass)}
            title={`Logged on the company alone. It sits under Other Contacts as “${userName ?? "you"} Bypassed” until someone claims it for a person.`}
            className={`badge min-h-11 cursor-pointer gap-1 border transition-colors sm:min-h-0 ${
              bypass
                ? "border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-[var(--text)]"
                : "border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-strong)]"
            }`}
            data-testid="company-bypass-tick"
          >
            {bypass && <IconCheck size={10} />}
            Front desk / main line
          </button>
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setDraft({ name: q, email: "", phone: "" });
              setAdding(true);
            }}
            className="btn btn-ghost btn-sm min-h-11 sm:min-h-0"
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
      {bypass && (
        <p className="faint text-xs" data-testid="company-bypass-note">
          Logged on the company alone, as “{userName ?? "you"} Bypassed” until someone claims it for a person.
        </p>
      )}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
