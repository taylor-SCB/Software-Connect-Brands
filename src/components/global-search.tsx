"use client";

import Link from "next/link";
import { useState } from "react";
import { IconBuilding, IconSearch, IconUsers } from "@/components/icons";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { useSearch } from "@/lib/use-search";

type Person = { id: string; name: string; company: string | null; phone?: string | null; email?: string | null };
type Business = { id: string; name: string; city: string | null; state: string | null };

// The search icon at the top of the sidebar and in the phone's top bar
// (BDR redesign, Nov 11, 2026): one box for people and companies, by name,
// company, email or phone, from the same searches the pickers use. A row
// opens the record; "See all" opens the list searched for the same words.
export function GlobalSearch({ className = "", testId = "global-search" }: { className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim();
  const people = useSearch<Person>(open && q ? `/dashboard/contacts/search?q=${encodeURIComponent(q)}` : null);
  const companies = useSearch<Business>(open && q ? `/dashboard/companies/search?q=${encodeURIComponent(q)}` : null);
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label="Search people and companies" data-testid={testId}>
        <IconSearch size={16} />
      </button>
      <Sheet open={open} onClose={close} title="Search" testId="global-search-sheet">
        <label className="relative block">
          <span className="sr-only">Search people and companies</span>
          <IconSearch size={14} className="faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            data-autofocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, company, phone or email"
            className="input w-full pl-8"
            data-testid="global-search-input"
          />
        </label>
        {q && (
          <div className="mt-3 space-y-4" aria-busy={people.loading || companies.loading}>
            <section>
              <h3 className="eyebrow mb-1">People</h3>
              {people.results.length === 0 ? (
                <p className="faint px-2 py-1 text-sm">{people.loading ? "Looking…" : "Nobody by that name"}</p>
              ) : (
                <ul className="divide-y divide-[var(--hairline-3)]">
                  {people.results.slice(0, 8).map((person) => (
                    <li key={person.id}>
                      <Link href={`/dashboard/contacts/${person.id}`} onClick={close} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--hover)] pointer-coarse:min-h-11" data-testid="global-search-person">
                        <IconUsers size={14} className="faint shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{person.name}</span>
                          <span className="faint block truncate text-xs">{[person.company, person.phone ?? person.email].filter(Boolean).join(" · ")}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/dashboard/contacts?q=${encodeURIComponent(q)}`} onClick={close} className="link mt-1 inline-block px-2 text-xs">
                See all people matching &ldquo;{q}&rdquo;
              </Link>
            </section>
            <section>
              <h3 className="eyebrow mb-1">Companies</h3>
              {companies.results.length === 0 ? (
                <p className="faint px-2 py-1 text-sm">{companies.loading ? "Looking…" : "No company by that name"}</p>
              ) : (
                <ul className="divide-y divide-[var(--hairline-3)]">
                  {companies.results.slice(0, 6).map((company) => (
                    <li key={company.id}>
                      <Link href={`/dashboard/companies/${company.id}`} onClick={close} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--hover)] pointer-coarse:min-h-11" data-testid="global-search-company">
                        <IconBuilding size={14} className="faint shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{company.name}</span>
                          {(company.city || company.state) && <span className="faint block truncate text-xs">{[company.city, company.state].filter(Boolean).join(", ")}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/dashboard/companies?q=${encodeURIComponent(q)}`} onClick={close} className="link mt-1 inline-block px-2 text-xs">
                See all companies matching &ldquo;{q}&rdquo;
              </Link>
            </section>
          </div>
        )}
      </Sheet>
    </>
  );
}
