"use client";

import { useMemo, useState } from "react";
import { IconPlus, IconCheck, IconBuilding } from "@/components/icons";

// The Company box on a contact form. Type to search the companies that
// already exist; a name nobody has typed before becomes a new company
// when the contact is saved (the server finds-or-creates by name, so two
// people can't accidentally make "Acme" twice).
export function CompanyPicker({
  companies,
  defaultName = "",
  name = "companyName",
  label = "Company",
}: {
  companies: { id: string; name: string }[];
  defaultName?: string;
  name?: string;
  label?: string;
}) {
  const [value, setValue] = useState(defaultName);
  const [open, setOpen] = useState(false);

  const query = value.trim().toLowerCase();
  const matches = useMemo(
    () =>
      query
        ? companies.filter((company) => company.name.toLowerCase().includes(query)).slice(0, 8)
        : companies.slice(0, 8),
    [companies, query],
  );
  const exact = companies.find((company) => company.name.toLowerCase() === query);

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
          <input
            id={name}
            name={name}
            value={value}
            autoComplete="off"
            placeholder="Search or type a new company…"
            onChange={(event) => {
              setValue(event.target.value);
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
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto py-1 shadow-xl"
        >
          {matches.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                role="option"
                aria-selected={company.name === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setValue(company.name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(255_255_255/0.05)]"
              >
                <IconBuilding size={13} className="text-[var(--text-faint)]" />
                {company.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
