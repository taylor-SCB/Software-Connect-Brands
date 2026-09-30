"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconMerge, IconSearch, IconX } from "@/components/icons";
import { FormError } from "@/components/ui";
import { useSearch } from "@/lib/use-search";
import { mergeCompaniesAction, mergeContactsAction } from "@/app/dashboard/merge-actions";

type Hit = {
  id: string;
  name: string;
  // Contacts
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  // Companies
  city?: string | null;
  state?: string | null;
};

const MAX = 5;

function detail(kind: "contacts" | "companies", hit: Hit) {
  const parts = kind === "contacts" ? [hit.email, hit.phone, hit.company] : [[hit.city, hit.state].filter(Boolean).join(", ")];
  return parts.filter(Boolean).join(" · ") || (kind === "contacts" ? "No email or phone on file" : "No city on file");
}

// "Merge" on the Contacts and Companies lists: find the duplicates (each
// shown with what tells them apart), pick the one to keep, and everything
// on the others moves onto it. The kept record's details win; its blanks
// are filled from the others.
export function MergeButton({ kind }: { kind: "contacts" | "companies" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Hit[]>([]);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const noun = kind === "contacts" ? "contacts" : "companies";

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const q = query.trim();
  const { results, loading } = useSearch<Hit>(open && q ? `/dashboard/${kind}/search?q=${encodeURIComponent(q)}` : null);

  function toggle(hit: Hit) {
    setConfirming(false);
    if (picked.some((row) => row.id === hit.id)) {
      const next = picked.filter((row) => row.id !== hit.id);
      setPicked(next);
      if (keepId === hit.id) setKeepId(next[0]?.id ?? null);
      return;
    }
    if (picked.length >= MAX) return;
    setPicked([...picked, hit]);
    if (!keepId) setKeepId(hit.id);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setPicked([]);
    setKeepId(null);
    setConfirming(false);
    setError(undefined);
  }

  function merge() {
    if (!keepId) return;
    setError(undefined);
    start(async () => {
      const action = kind === "contacts" ? mergeContactsAction : mergeCompaniesAction;
      const result = await action({ keepId, ids: picked.map((row) => row.id) });
      if (result.error || !result.keptId) {
        setError(result.error ?? "Couldn't merge those");
        setConfirming(false);
        return;
      }
      close();
      router.push(`/dashboard/${kind}/${result.keptId}`);
    });
  }

  const keeper = picked.find((row) => row.id === keepId);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="merge-open">
        <IconMerge size={13} />
        Merge {kind === "contacts" ? "Contacts" : "Companies"}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Merge ${noun}`}
            onClick={(event) => event.stopPropagation()}
            className="card card-lit popover flex max-h-[88vh] w-full max-w-xl flex-col"
            data-testid="merge-dialog"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold">Merge duplicate {noun}</h2>
                <p className="faint mt-0.5 text-xs">
                  Pick up to {MAX}, then the one to keep. Everything on the others moves onto it.
                </p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="btn btn-ghost btn-sm">
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
                  placeholder={kind === "contacts" ? "Search by name, email or phone…" : "Search by name or city…"}
                  aria-label={`Search ${noun}`}
                  autoFocus
                  className="input input-sm pl-8"
                  data-testid="merge-search"
                />
              </div>
              {q && (
                <ul className="mt-2 max-h-48 overflow-y-auto" data-testid="merge-results">
                  {results.map((hit) => {
                    const on = picked.some((row) => row.id === hit.id);
                    return (
                      <li key={hit.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-[rgb(255_255_255/0.04)]">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!on && picked.length >= MAX}
                            onChange={() => toggle(hit)}
                            className="h-4 w-4 accent-[var(--brand)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{hit.name}</span>
                            <span className="faint block truncate text-xs">{detail(kind, hit)}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                  {!loading && results.length === 0 && <li className="faint px-2 py-2 text-xs">No {noun} match.</li>}
                </ul>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {picked.length === 0 ? (
                <p className="faint py-4 text-center text-xs">Search above and tick the duplicates.</p>
              ) : (
                <fieldset>
                  <legend className="faint mb-2 text-xs">Keep which one?</legend>
                  <ul className="space-y-1.5" data-testid="merge-picked">
                    {picked.map((hit) => (
                      <li key={hit.id}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                            keepId === hit.id ? "border-[var(--brand)]" : "border-[var(--border)]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="keep"
                            checked={keepId === hit.id}
                            onChange={() => {
                              setKeepId(hit.id);
                              setConfirming(false);
                            }}
                            className="accent-[var(--brand)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{hit.name}</span>
                            <span className="faint block truncate text-xs">{detail(kind, hit)}</span>
                          </span>
                          {keepId === hit.id && <span className="text-[0.66rem] text-[var(--brand)]">keep</span>}
                          <button type="button" onClick={() => toggle(hit)} aria-label={`Take ${hit.name} out`} className="btn btn-ghost btn-sm !px-1.5">
                            <IconX size={11} />
                          </button>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
            </div>

            <div className="border-t border-[var(--border)] px-5 py-3">
              <FormError message={error} />
              {confirming && keeper ? (
                <div className="flex flex-wrap items-center justify-between gap-2" data-testid="merge-confirm">
                  <p className="text-xs text-[var(--warn)]">
                    {picked.length - 1} will be folded into {keeper.name} and deleted. This can&apos;t be undone.
                  </p>
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm">
                      Back
                    </button>
                    <button type="button" onClick={merge} disabled={pending} className="btn btn-danger btn-sm" data-testid="merge-yes">
                      {pending ? "Merging…" : "Yes, merge"}
                    </button>
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="faint text-xs">{picked.length} picked</span>
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={picked.length < 2 || !keeper}
                    className="btn btn-primary btn-sm"
                    data-testid="merge-go"
                  >
                    {picked.length < 2 ? "Pick at least two" : `Merge ${picked.length} into one`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
