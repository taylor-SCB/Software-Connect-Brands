"use client";

import { useEffect, useState } from "react";
import { IconSearch, IconUsers, IconX, IconCheck } from "@/components/icons";
import { useSearch } from "@/lib/use-search";

export type PickableContact = { id: string; name: string; company: string | null };

// "+ Include multiple contacts" on the note and activity forms. Opens a
// picker that searches the workspace's contacts as you type; the contact
// whose page you are on is locked in. Each extra pick becomes a hidden
// `extraContactIds` field, so the server writes one copy per person.
export function ContactMultiSelect({ current }: { current: PickableContact }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, PickableContact>>(new Map());

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const { results, loading } = useSearch<PickableContact>(
    open ? `/dashboard/contacts/search?q=${encodeURIComponent(query.trim())}&exclude=${current.id}` : null,
  );
  const picked = Array.from(selected.values());

  function toggle(contact: PickableContact) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(contact.id)) next.delete(contact.id);
      else next.set(contact.id, contact);
      return next;
    });
  }

  return (
    <>
      {picked.map((contact) => (
        <input key={contact.id} type="hidden" name="extraContactIds" value={contact.id} />
      ))}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={`btn btn-sm ${picked.length ? "btn-primary" : "btn-ghost"}`}
        >
          <IconUsers size={13} />
          {picked.length ? `Includes ${picked.length + 1} contacts` : "+ Include multiple contacts"}
        </button>
        {picked.map((contact) => (
          <span key={contact.id} className="badge gap-1">
            {contact.name}
            <button
              type="button"
              onClick={() => toggle(contact)}
              aria-label={`Remove ${contact.name}`}
              className="opacity-70 hover:opacity-100"
            >
              <IconX size={10} />
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Include multiple contacts"
            onClick={(event) => event.stopPropagation()}
            className="card card-lit flex max-h-[80vh] w-full max-w-md flex-col"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold">Include multiple contacts</h2>
                <p className="faint mt-0.5 text-xs">The same entry is logged on everyone you tick.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="btn btn-ghost btn-sm">
                <IconX size={13} />
              </button>
            </div>

            <div className="border-b border-[var(--border)] p-3">
              <div className="relative">
                <IconSearch
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search contacts…"
                  aria-label="Search contacts"
                  autoFocus
                  className="input input-sm pl-8"
                />
              </div>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              <li className="flex items-center gap-3 px-5 py-2 text-sm opacity-70">
                <span className="flex h-4 w-4 items-center justify-center rounded border border-[var(--brand)] bg-[var(--brand)] text-white">
                  <IconCheck size={10} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {current.name}
                  {current.company && <span className="faint"> · {current.company}</span>}
                </span>
                <span className="faint text-[0.66rem]">this contact</span>
              </li>
              {/* Picks stay listed even when the search moves on, so a tick is never lost from view. */}
              {picked
                .filter((contact) => !results.some((row) => row.id === contact.id))
                .map((contact) => (
                  <ContactRow key={contact.id} contact={contact} on onToggle={() => toggle(contact)} />
                ))}
              {results.map((contact) => (
                <ContactRow key={contact.id} contact={contact} on={selected.has(contact.id)} onToggle={() => toggle(contact)} />
              ))}
              {!loading && results.length === 0 && (
                <li className="faint px-5 py-6 text-center text-xs">
                  {query.trim() ? "No other contacts match." : "Type a name, company or email."}
                </li>
              )}
            </ul>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
              <span className="faint text-xs">{picked.length + 1} selected</span>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-primary btn-sm">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ContactRow({ contact, on, onToggle }: { contact: PickableContact; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-5 py-2 text-sm hover:bg-[rgb(255_255_255/0.04)]">
        <input type="checkbox" checked={on} onChange={onToggle} className="h-4 w-4 accent-[var(--brand)]" />
        <span className="min-w-0 flex-1 truncate">
          {contact.name}
          {contact.company && <span className="faint"> · {contact.company}</span>}
        </span>
      </label>
    </li>
  );
}
