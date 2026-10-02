"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlus, IconCheck, IconBuilding } from "@/components/icons";
import { useSearch } from "@/lib/use-search";

export type PickedCompany = {
  id: string;
  name: string;
  industries: string[];
  companyTypes: string[];
  city?: string | null;
  state?: string | null;
};

// The Company box on a contact form. Type to search the companies that
// already exist (the server returns the ten best matches); a name nobody
// has typed before becomes a new company when the contact is saved (the
// server finds-or-creates by name, so two people can't accidentally make
// "Acme" twice). `onChange` tells the form which company is now in the
// box, or null when the name is new or empty, so the Industry / Company
// Type picker can show that company's tags.
//
// The exact company picked also travels as a hidden `companyId` (Sept 30,
// 2026): two businesses can share a name — Acme Roofing in Austin and in
// Dallas — and matching by name alone filed a contact added from the
// Dallas page under Austin. Typing clears it; picking or a preset sets it.
export function CompanyPicker({
  defaultName = "",
  defaultId = null,
  name = "companyName",
  label = "Company",
  onChange,
}: {
  defaultName?: string;
  defaultId?: string | null;
  name?: string;
  label?: string;
  onChange?: (company: PickedCompany | null, typed: string) => void;
}) {
  const [value, setValue] = useState(defaultName);
  const [pickedId, setPickedId] = useState<string | null>(defaultId);
  const [open, setOpen] = useState(false);

  const query = value.trim();
  const { results } = useSearch<PickedCompany>(
    open || query ? `/dashboard/companies/search?q=${encodeURIComponent(query)}` : null,
  );
  // The one picked wins over another of the same name.
  const exact =
    results.find((company) => company.id === pickedId && company.name.toLowerCase() === query.toLowerCase()) ??
    results.find((company) => company.name.toLowerCase() === query.toLowerCase());

  function commit(next: string, picked: PickedCompany | null) {
    setValue(next);
    setPickedId(picked?.id ?? null);
    onChange?.(picked, next);
  }

  // Typing an existing company's name in full counts as picking it, as
  // soon as the search confirms it exists — not only on blur, which an
  // Enter-key save never triggers.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const exactId = exact?.id ?? null;
  useEffect(() => {
    if (!exact || !exactId) return;
    // A picked company keeps its place; only a typed name adopts a match.
    if (pickedId && pickedId !== exactId) return;
    onChangeRef.current?.(exact, exact.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exactId stands in for the exact object
  }, [exactId]);

  return (
    <div className="relative">
      <label className="label" htmlFor={name}>
        {label}
        <span className="faint font-normal"> · optional</span>
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <IconBuilding
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input type="hidden" name="companyId" value={pickedId ?? exact?.id ?? ""} />
          <input
            id={name}
            name={name}
            value={value}
            autoComplete="off"
            placeholder="Search or type a new company…"
            onChange={(event) => {
              commit(event.target.value, null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            className="input pl-8"
          />
        </div>
        {query && !exact && (
          <span
            className="btn btn-ghost btn-sm shrink-0 cursor-default"
            title="This company will be created when you save"
          >
            <IconPlus size={12} />
            New company
          </span>
        )}
        {exact && (
          <span className="btn btn-ghost btn-sm shrink-0 cursor-default text-[var(--ok)]">
            <IconCheck size={12} />
            Existing
          </span>
        )}
      </div>
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="card popover absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto py-1"
        >
          {results.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                role="option"
                aria-selected={company.name === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  commit(company.name, company);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(255_255_255/0.05)]"
              >
                <IconBuilding size={13} className="text-[var(--text-faint)]" />
                <span className="min-w-0 flex-1 truncate">{company.name}</span>
                {(company.city || company.state) && (
                  <span className="faint shrink-0 text-xs">{[company.city, company.state].filter(Boolean).join(", ")}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
