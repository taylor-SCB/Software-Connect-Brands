"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconBuilding, IconCheck, IconPlus, IconSearch, IconX } from "@/components/icons";
import { FormError } from "@/components/ui";
import { useSearch } from "@/lib/use-search";
import { linkContactAccounts } from "@/app/dashboard/contacts/account-actions";

type CompanyHit = { id: string; name: string; city: string | null; state: string | null };

function where(company: { city: string | null; state: string | null }) {
  return [company.city, company.state].filter(Boolean).join(", ");
}

// "+ Additional Account" on a contact's page. Searches the workspace's
// companies as you type, each shown with its City, State so two Acmes
// can be told apart; tick as many as apply, or add a new company, then
// link them all at once. Common for an entrepreneur with three
// businesses and one phone number.
export function AdditionalAccountButton({
  contactId,
  contactName,
  linkedIds,
}: {
  contactId: string;
  contactName: string;
  // Their main company and the ones already linked: shown ticked and
  // locked, so nothing is linked twice.
  linkedIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, CompanyHit>>(new Map());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", city: "", state: "" });
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const { results, loading } = useSearch<CompanyHit>(
    open ? `/dashboard/companies/search?q=${encodeURIComponent(query.trim())}` : null,
  );
  const picked = Array.from(selected.values());
  const newName = draft.name.trim();
  const count = picked.length + (adding && newName ? 1 : 0);

  function toggle(company: CompanyHit) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(company.id)) next.delete(company.id);
      else next.set(company.id, company);
      return next;
    });
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setSelected(new Map());
    setAdding(false);
    setDraft({ name: "", city: "", state: "" });
    setError(undefined);
  }

  function save() {
    setError(undefined);
    start(async () => {
      const result = await linkContactAccounts({
        contactId,
        companyIds: picked.map((company) => company.id),
        newCompany: adding && newName ? { name: newName, city: draft.city.trim(), state: draft.state.trim() } : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="additional-account">
        <IconPlus size={13} />
        Additional Account
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Additional accounts"
            onClick={(event) => event.stopPropagation()}
            className="card card-lit popover flex max-h-[85vh] w-full max-w-lg flex-col"
            data-testid="additional-account-dialog"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold">Link {contactName} to more companies</h2>
                <p className="faint mt-0.5 text-xs">Their main company stays the one their quotes and contracts go under.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="btn btn-ghost btn-sm">
                <IconX size={13} />
              </button>
            </div>

            <div className="border-b border-[var(--border)] p-3">
              <div className="relative">
                <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search companies by name or city…"
                  aria-label="Search companies"
                  autoFocus
                  className="input input-sm pl-8"
                  data-testid="account-search"
                />
              </div>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="account-results">
              {/* Picks stay listed when the search moves on, so a tick is never lost from view. */}
              {picked
                .filter((company) => !results.some((row) => row.id === company.id))
                .map((company) => (
                  <CompanyRow key={company.id} company={company} on onToggle={() => toggle(company)} />
                ))}
              {results.map((company) => {
                const already = linkedIds.includes(company.id);
                return (
                  <CompanyRow
                    key={company.id}
                    company={company}
                    on={already || selected.has(company.id)}
                    locked={already}
                    onToggle={() => toggle(company)}
                  />
                );
              })}
              {!loading && results.length === 0 && (
                <li className="faint px-5 py-6 text-center text-xs">
                  {query.trim() ? "No companies match. Add it as a new one below." : "No companies yet."}
                </li>
              )}
            </ul>

            <div className="border-t border-[var(--border)] p-3">
              {adding ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem_4.5rem_auto]" data-testid="account-new">
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="New company name"
                    aria-label="New company name"
                    maxLength={120}
                    autoFocus
                    className="input input-sm"
                  />
                  <input
                    value={draft.city}
                    onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                    placeholder="City"
                    aria-label="New company city"
                    maxLength={120}
                    className="input input-sm"
                  />
                  <input
                    value={draft.state}
                    onChange={(event) => setDraft({ ...draft, state: event.target.value })}
                    placeholder="ST"
                    aria-label="New company state"
                    maxLength={60}
                    className="input input-sm"
                  />
                  <button type="button" onClick={() => setAdding(false)} aria-label="Cancel new company" className="btn btn-ghost btn-sm">
                    <IconX size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ name: query.trim(), city: "", state: "" });
                    setAdding(true);
                  }}
                  className="btn btn-ghost btn-sm"
                  data-testid="account-add-new"
                >
                  <IconPlus size={12} />
                  Add new company{query.trim() ? ` “${query.trim()}”` : ""}
                </button>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-5 py-3">
              <FormError message={error} />
              <div className="flex items-center justify-between">
                <span className="faint text-xs">{count} selected</span>
                <button type="button" onClick={save} disabled={pending || count === 0} className="btn btn-primary btn-sm" data-testid="account-save">
                  {pending ? "Linking…" : count > 1 ? `Link ${count} companies` : "Link company"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CompanyRow({
  company,
  on,
  locked = false,
  onToggle,
}: {
  company: CompanyHit;
  on: boolean;
  locked?: boolean;
  onToggle: () => void;
}) {
  const place = where(company);
  return (
    <li>
      <label
        className={`flex items-center gap-3 px-5 py-2 text-sm ${locked ? "opacity-60" : "cursor-pointer hover:bg-[rgb(255_255_255/0.04)]"}`}
        data-testid="account-row"
      >
        <input type="checkbox" checked={on} disabled={locked} onChange={onToggle} className="h-4 w-4 accent-[var(--brand)]" />
        <IconBuilding size={13} className="shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate">
          {company.name}
          {place && <span className="faint"> · {place}</span>}
        </span>
        {locked && (
          <span className="faint inline-flex items-center gap-1 text-[0.66rem]">
            <IconCheck size={10} />
            already linked
          </span>
        )}
      </label>
    </li>
  );
}
