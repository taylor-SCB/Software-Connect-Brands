"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconPlus, IconSearch, IconUserPlus } from "@/components/icons";
import { FormError } from "@/components/ui";
import { useSearch } from "@/lib/use-search";
import { addExistingPersonToCompany } from "@/app/dashboard/contacts/account-actions";

export type PersonHit = {
  id: string;
  name: string;
  company: string | null;
  companyId: string | null;
  email: string | null;
  phone: string | null;
};

// Add person on a company page. Typing a name searches everyone already
// in the workspace first, each with their email, phone and company, so
// the right Matt Smith gets linked and nobody is entered twice. Nobody
// matching? "Add new person" opens the full form with the company and
// the typed name filled in.
export function AddPersonSearch({ companyId, companyName, compact = false }: { companyId: string; companyName: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim();
  const { results, loading } = useSearch<PersonHit>(open && q ? `/dashboard/contacts/search?q=${encodeURIComponent(q)}` : null);
  const newHref = `/dashboard/contacts/new?companyId=${companyId}${q ? `&name=${encodeURIComponent(q)}` : ""}`;

  function pick(person: PersonHit) {
    setMessage({});
    start(async () => {
      const result = await addExistingPersonToCompany(companyId, person.id);
      if (result.error) {
        setMessage({ error: result.error });
        return;
      }
      setMessage({ success: result.success });
      setQuery("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
        data-testid={compact ? "add-person-compact" : "add-person"}
      >
        {compact ? <IconPlus size={12} /> : <IconUserPlus size={13} />}
        {compact ? "Add" : "Add person"}
      </button>

      {open && (
        <div className="card popover absolute right-0 top-full z-40 mt-1 w-[22rem] max-w-[90vw]" data-testid="add-person-panel">
          <div className="border-b border-[var(--border)] p-2.5">
            <label className="faint mb-1 block text-[0.7rem]" htmlFor={`add-person-${companyId}`}>
              Contact name — checks who&apos;s already in your contacts
            </label>
            <div className="relative">
              <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                id={`add-person-${companyId}`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, email or phone…"
                autoFocus
                autoComplete="off"
                className="input input-sm pl-8"
                data-testid="add-person-input"
              />
            </div>
          </div>

          {q && (
            <ul className="max-h-72 overflow-y-auto py-1" data-testid="add-person-results">
              {results.map((person) => {
                const here = person.companyId === companyId;
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      disabled={pending || here}
                      onClick={() => pick(person)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(255_255_255/0.04)] disabled:opacity-60"
                      data-testid="add-person-hit"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{person.name}</span>
                        <span className="faint block truncate text-xs">
                          {[person.email, person.phone].filter(Boolean).join(" · ") || "No email or phone on file"}
                        </span>
                        {person.company && <span className="faint block truncate text-[0.68rem]">{person.company}</span>}
                      </span>
                      <span className="faint shrink-0 text-[0.66rem]">{here ? "already here" : "Link"}</span>
                    </button>
                  </li>
                );
              })}
              {!loading && results.length === 0 && <li className="faint px-3 py-3 text-xs">Nobody by that name yet.</li>}
            </ul>
          )}

          <div className="border-t border-[var(--border)] p-2.5">
            <Link href={newHref} className="btn btn-ghost btn-sm w-full justify-start" data-testid="add-person-new">
              <IconPlus size={12} />
              {q ? `Add new person “${q}” to ${companyName}` : `Add a new person to ${companyName}`}
            </Link>
            <FormError message={message.error} />
          </div>
        </div>
      )}
    </div>
  );
}
