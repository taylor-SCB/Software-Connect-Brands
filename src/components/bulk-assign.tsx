"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconUserPlus, IconX } from "@/components/icons";
import { MAX_ASSIGN } from "@/lib/list-params";
import { assignRecords, undoAssign, type AssignUndo } from "@/app/dashboard/assign-actions";

// Tick boxes on the Contacts and Companies rows and the bar that assigns
// them (Nov 10, 2026, Taylor): Assign to me / Assign to… / Unassign, for
// the ticked rows or for every record matching the filters, up to 1,000 a
// go. The table stays a server component; only the boxes and the bar are
// drawn here and share the ticks through context.
//
// BDR redesign (Nov 11, 2026, decision 15): the bar sits at the foot of
// the screen while anything is ticked; taking records a teammate owns asks
// first, naming them ("12 of these belong to Priya. Take them?"), and
// every assign can be undone. On a phone the boxes show only in Select
// mode.

type Selection = {
  ids: Set<string>;
  pageIds: string[];
  toggle: (id: string) => void;
  setPage: (on: boolean) => void;
  selecting: boolean;
  setSelecting: (on: boolean) => void;
};

const SelectionContext = createContext<Selection | null>(null);

type Confirm = { target: string; count: number; owners: { name: string; count: number }[] };

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
  const [selecting, setSelecting] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [undo, setUndo] = useState<AssignUndo | null>(null);
  const [pending, start] = useTransition();

  // A new page or new filters start with nothing ticked.
  const pageKey = `${query}|${pageIds.join(",")}`;
  const [seenKey, setSeenKey] = useState(pageKey);
  if (seenKey !== pageKey) {
    setSeenKey(pageKey);
    setIds(new Set());
    setAllMatching(false);
    setConfirm(null);
  }

  const selection: Selection = {
    ids,
    pageIds,
    toggle: (id) => {
      setAllMatching(false);
      setConfirm(null);
      setIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    setPage: (on) => {
      setAllMatching(false);
      setConfirm(null);
      setIds(on ? new Set(pageIds) : new Set());
    },
    selecting,
    setSelecting: (on) => {
      setSelecting(on);
      if (!on) {
        setIds(new Set());
        setAllMatching(false);
        setConfirm(null);
      }
    },
  };

  const count = allMatching ? Math.min(total, MAX_ASSIGN) : ids.size;
  const wholePage = pageIds.length > 0 && pageIds.every((id) => ids.has(id));

  function assign(target: string, confirmed = false) {
    setMessage(null);
    setUndo(null);
    start(async () => {
      const result = await assignRecords(
        allMatching
          ? { kind, to: target, query, interested, confirmed }
          : { kind, to: target, ids: Array.from(ids), confirmed },
      );
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
        return;
      }
      if ("confirm" in result) {
        setConfirm({ target, ...result.confirm });
        return;
      }
      setConfirm(null);
      const who = result.repName ?? "Unassigned";
      const left = result.left;
      setMessage({
        text:
          `${result.assigned.toLocaleString()} ${result.assigned === 1 ? "record" : "records"} → ${who}.` +
          (allMatching && left > 0 ? ` ${left.toLocaleString()} more still match; run it again for the next ${Math.min(left, MAX_ASSIGN).toLocaleString()}.` : ""),
      });
      if (result.undo.groups.length > 0) setUndo(result.undo);
      setIds(new Set());
      setAllMatching(false);
      router.refresh();
    });
  }

  function runUndo() {
    if (!undo) return;
    const last = undo;
    setUndo(null);
    start(async () => {
      const result = await undoAssign(last);
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
        return;
      }
      setMessage({ text: `Undone · ${result.restored.toLocaleString()} ${result.restored === 1 ? "record" : "records"} back as they were.` });
      router.refresh();
    });
  }

  const ownersText = confirm
    ? confirm.owners.length === 1
      ? `${confirm.count.toLocaleString()} of these ${confirm.count === 1 ? "belongs" : "belong"} to ${confirm.owners[0].name}.`
      : `${confirm.count.toLocaleString()} of these belong to teammates (${confirm.owners.map((owner) => `${owner.name} ${owner.count}`).join(", ")}).`
    : "";

  return (
    <SelectionContext.Provider value={selection}>
      {children}
      {(count > 0 || message) && (
        <div
          className="card popover sticky bottom-3 z-30 mt-3 flex flex-wrap items-center gap-2 px-3 py-2 text-sm shadow-lg"
          data-testid="bulk-bar"
          role="region"
          aria-label="Assign the ticked records"
        >
          {count > 0 && !confirm && (
            <>
              <span className="font-medium" data-testid="bulk-count">
                {allMatching
                  ? total > MAX_ASSIGN
                    ? `The first ${MAX_ASSIGN.toLocaleString()} of ${total.toLocaleString()} matching`
                    : `All ${total.toLocaleString()} matching`
                  : `${count.toLocaleString()} selected`}
              </span>
              {!allMatching && wholePage && total > pageIds.length && (
                <button type="button" className="link min-h-[44px] text-xs md:min-h-0" onClick={() => setAllMatching(true)} data-testid="bulk-all">
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
          {confirm && (
            <div className="flex w-full flex-wrap items-center gap-2" data-testid="bulk-confirm" role="alertdialog" aria-label="Take a teammate's records?">
              <span className="font-medium">
                {ownersText} {confirm.target === "" ? "Unassign them?" : "Take them?"}
              </span>
              <span className="ml-auto flex gap-1.5">
                <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => assign(confirm.target, true)} data-testid="bulk-confirm-yes">
                  {confirm.target === "" ? "Yes, unassign" : "Yes, take them"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setConfirm(null)} data-testid="bulk-confirm-no">
                  Cancel
                </button>
              </span>
            </div>
          )}
          {message && (
            <p className={`flex w-full flex-wrap items-center gap-2 text-xs ${message.error ? "text-[var(--danger)]" : "text-[var(--ok)]"}`} role="status">
              <span data-testid="bulk-message">{message.text}</span>
              {undo && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={runUndo} data-testid="bulk-undo">
                  Undo
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm !px-1.5 ml-auto" onClick={() => (setMessage(null), setUndo(null))} aria-label="Dismiss">
                <IconX size={12} />
              </button>
            </p>
          )}
        </div>
      )}
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
      aria-label={`Select ${label}`}
      title={label}
      data-testid="row-check"
      className="mr-1.5 h-3.5 w-3.5 align-middle accent-[var(--brand)]"
    />
  );
}

// The phone card's box: only in Select mode.
export function CardCheck({ id, label }: { id: string; label: string }) {
  const selection = useContext(SelectionContext);
  if (!selection?.selecting) return null;
  return (
    <label className="-m-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        checked={selection.ids.has(id)}
        onChange={() => selection.toggle(id)}
        aria-label={`Select ${label}`}
        data-testid="card-check"
        className="h-5 w-5 accent-[var(--brand)]"
      />
    </label>
  );
}

// "Select" on a phone: shows the boxes, or puts them away.
export function SelectToggle() {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <button
      type="button"
      onClick={() => selection.setSelecting(!selection.selecting)}
      aria-pressed={selection.selecting}
      className={`btn btn-sm min-h-[44px] ${selection.selecting ? "btn-primary" : "btn-ghost"}`}
      data-testid="select-mode"
    >
      {selection.selecting ? "Done selecting" : "Select"}
    </button>
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
