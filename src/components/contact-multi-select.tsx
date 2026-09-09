"use client";

import { useEffect, useMemo, useState } from "react";
import { IconSearch, IconUsers, IconX, IconCheck } from "@/components/icons";

export type PickableContact = { id: string; name: string; company: string | null };

// "+ Include multiple contacts" on the note and activity forms. Opens a
// picker over every contact in the workspace; the contact whose page you
// are on is locked in. Each extra pick becomes a hidden `extraContactIds`
// field, so the server writes one copy per person.
export function ContactMultiSelect({
  contacts,
  currentId,
}: {
  contacts: PickableContact[];
  currentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const current = contacts.find((contact) => contact.id === currentId);
  const others = useMemo(() => contacts.filter((contact) => contact.id !== currentId), [contacts, currentId]);
  const q = query.trim().toLowerCase();
  const visible = q
    ? others.filter(
        (contact) =>
          contact.name.toLowerCase().includes(q) ||
          (contact.company ?? "").toLowerCase().includes(q),
      )
    : others;
  const picked = others.filter((contact) => selected.has(contact.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          {picked.length
            ? `Includes ${picked.length + 1} contacts`
            : "+ Include multiple contacts"}
        </button>
        {picked.map((contact) => (
          <span key={contact.id} className="badge gap-1">
            {contact.name}
            <button
              type="button"
              onClick={() => toggle(contact.id)}
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
                <p className="faint mt-0.5 text-xs">
                  The same entry is logged on everyone you tick.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="btn btn-ghost btn-sm"
              >
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
              {current && (
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
              )}
              {visible.length === 0 && (
                <li className="faint px-5 py-6 text-center text-xs">No other contacts match.</li>
              )}
              {visible.map((contact) => {
                const on = selected.has(contact.id);
                return (
                  <li key={contact.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-5 py-2 text-sm hover:bg-[rgb(255_255_255/0.04)]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(contact.id)}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {contact.name}
                        {contact.company && <span className="faint"> · {contact.company}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
              <span className="faint text-xs">
                {picked.length + 1} selected
              </span>
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
