"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconUserPlus, IconX } from "@/components/icons";
import { MAX_ASSIGN } from "@/lib/list-params";
import { assignRecords } from "@/app/dashboard/assign-actions";

// Tick boxes on the Contacts and Companies rows and the bar that assigns
// them (Nov 10, 2026, Taylor): Assign to me / Assign to… / Unassign, for
// the ticked rows or for every record matching the filters, up to 1,000 a
// go. The table stays a server component; only the boxes and the bar are
// drawn here and share the ticks through context.

type Selection = {
  ids: Set<string>;
  pageIds: string[];
  toggle: (id: string) => void;
  setPage: (on: boolean) => void;
};

const SelectionContext = createContext<Selection | null>(null);

export function BulkAssign({
  kind,
  pageIds,
  total,
  query,
  interested,
  reps,
  children,
}: {
  kind: "contacts" | "companies";
  pageIds: string[];
  // How many records match the filters, and the list's own query string
  // (the server reads the same filters back for "all matching").
  total: number;
  query: string;
  interested: boolean;
  reps: { id: string; name: string; removed: boolean }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();

  // A new page or new filters start with nothing ticked.
  const pageKey = `${query}|${pageIds.join(",")}`;
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setIds(new Set());
    setAllMatching(false);
  }

  const selection: Selection = {
    ids,
    pageIds,
    toggle: (id) => {
      setAllMatching(false);
      setIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    setPage: (on) => {
      setAllMatching(false);
      setIds(on ? new Set(pageIds) : new Set());
    },
  };

  const count = allMatching ? Math.min(total, MAX_ASSIGN) : ids.size;
  const wholePage = pageIds.length > 0 && pageIds.every((id) => ids.has(id));

  function assign(target: string) {
    setMessage(null);
    start(async () => {
      const result = await assignRecords(
        allMatching ? { kind, to: target, query, interested } : { kind, to: target, ids: Array.from(ids) },
      );
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
        return;
      }
      const who = result.repName ?? "Unassigned";
      const left = result.left;
      setMessage({
        text:
          `${result.assigned.toLocaleString()} ${result.assigned === 1 ? "record" : "records"} → ${who}.` +
          (allMatching && left > 0 ? ` ${left.toLocaleString()} more still match; run it again for the next ${Math.min(left, MAX_ASSIGN).toLocaleString()}.` : ""),
      });
      setIds(new Set());
      setAllMatching(false);
      router.refresh();
    });
  }

  return (
    <SelectionContext.Provider value={selection}>
      {(count > 0 || message) && (
        <div className="card popover mb-3 flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="bulk-bar">
          {count > 0 && (
            <>
              <span className="font-medium" data-testid="bulk-count">
                {allMatching
                  ? total > MAX_ASSIGN
                    ? `The first ${MAX_ASSIGN.toLocaleString()} of ${total.toLocaleString()} matching`
                    : `All ${total.toLocaleString()} matching`
                  : `${count.toLocaleString()} selected`}
              </span>
              {!allMatching && wholePage && total > pageIds.length && (
                <button type="button" className="link text-xs" onClick={() => setAllMatching(true)} data-testid="bulk-all">
                  {total > MAX_ASSIGN
                    ? `Select the first ${MAX_ASSIGN.toLocaleString()} of all ${total.toLocaleString()} matching`
                    : `Select all ${total.toLocaleString()} matching these filters`}
                </button>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => assign("me")} data-testid="bulk-me">
                  <IconUserPlus size={13} />
                  Assign to me
                </button>
                <select
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  aria-label="Assign to"
                  className="select input-sm w-40 py-1"
                  data-testid="bulk-to"
                >
                  <option value="">Assign to…</option>
                  {reps
                    .filter((rep) => !rep.removed)
                    .map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.name}
                      </option>
                    ))}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending || !to} onClick={() => assign(to)} data-testid="bulk-assign">
                  Assign
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => assign("")} data-testid="bulk-unassign">
                  Unassign
                </button>
                <button type="button" className="btn btn-ghost btn-sm !px-1.5" onClick={() => selection.setPage(false)} aria-label="Clear the ticks">
                  <IconX size={12} />
                </button>
              </span>
            </>
          )}
          {message && (
            <p className={`w-full text-xs ${message.error ? "text-[var(--danger)]" : "text-[var(--ok)]"}`} data-testid="bulk-message">
              {message.text}
            </p>
          )}
        </div>
      )}
      {children}
    </SelectionContext.Provider>
  );
}

export function RowCheck({ id, label }: { id: string; label: string }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <input
      type="checkbox"
      checked={selection.ids.has(id)}
      onChange={() => selection.toggle(id)}
      aria-label="Select this row"
      title={label}
      data-testid="row-check"
      className="mr-1.5 h-3.5 w-3.5 align-middle accent-[var(--brand)]"
    />
  );
}

export function PageCheck() {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  const on = selection.pageIds.length > 0 && selection.pageIds.every((id) => selection.ids.has(id));
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={() => selection.setPage(!on)}
      aria-label="Select every row on this page"
      data-testid="page-check"
      className="h-3.5 w-3.5 align-middle accent-[var(--brand)]"
    />
  );
}
