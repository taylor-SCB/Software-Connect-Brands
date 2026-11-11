"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconPlus, IconSearch, IconUserPlus } from "@/components/icons";
import { FormError } from "@/components/ui";
import { FloatingMenu } from "@/components/floating-menu";
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
//
// The panel is a FloatingMenu (Nov 10, 2026): it was drawn right-aligned
// to the button, 22rem wide, so on a phone, where the button sits mid-row,
// it ran 72px off the left edge. Drawn on the page and placed against the
// window, it stays on screen at any width.
export function AddPersonSearch({ companyId, companyName, compact = false }: { companyId: string; companyName: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Straight into the search box. The panel is hidden for the moment it
  // takes to place it, and a hidden box can't take focus, so this waits a
  // frame rather than using autoFocus.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
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
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
        aria-expanded={open}
        data-testid={compact ? "add-person-compact" : "add-person"}
      >
        {compact ? <IconPlus size={12} /> : <IconUserPlus size={13} />}
        {compact ? "Add" : "Add person"}
      </button>

      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={352} testId="add-person-panel" label="Add person">
        <div className="border-b border-[var(--hairline-3)] p-2.5">
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
              ref={input}
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
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)] disabled:opacity-60"
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

        <div className="border-t border-[var(--hairline-3)] p-2.5">
          {/* Wraps rather than running past the panel with a long company
              or typed name. */}
          <Link href={newHref} className="btn btn-ghost btn-sm w-full justify-start whitespace-normal text-left" data-testid="add-person-new">
            <IconPlus size={12} />
            {q ? `Add new person “${q}” to ${companyName}` : `Add a new person to ${companyName}`}
          </Link>
          <FormError message={message.error} />
        </div>
      </FloatingMenu>
    </>
  );
}
