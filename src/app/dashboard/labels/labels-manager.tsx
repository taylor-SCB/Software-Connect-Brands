"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, FormError } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import type { LabelKind, LabelResult, LabelRow, LabelSections } from "@/lib/crm-labels";
import { mergeLabelAction, renameLabelAction, retireLabelAction } from "./actions";

const SECTIONS: { kind: LabelKind; title: string; subtitle: string; records: string }[] = [
  { kind: "industry", title: "Industry", subtitle: "On companies (and shown on their people).", records: "companies" },
  { kind: "type", title: "Company Type", subtitle: "On companies. A type sits under one or more industries.", records: "companies" },
  { kind: "lead", title: "Lead Label", subtitle: "On Pipeline opportunities. The five built-in labels can be merged into, not renamed.", records: "opportunities" },
  { kind: "title", title: "Job Title", subtitle: "On contacts, matched ignoring capitals. Rename or merge spellings into one.", records: "contacts" },
];

export function LabelsManager({ sections, titleQuery, canManage }: { sections: LabelSections; titleQuery: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Which row's box is open: "<kind>|<name>|rename" or "...|merge".
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ kind: LabelKind; text: string; error?: boolean } | null>(null);
  const [titleSearch, setTitleSearch] = useState(titleQuery);

  function run(kind: LabelKind, action: () => Promise<LabelResult>) {
    setResult(null);
    start(async () => {
      const done = await action();
      if ("error" in done) {
        setResult({ kind, text: done.error, error: true });
        return;
      }
      setResult({ kind, text: done.message });
      setOpen(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {!canManage && (
        <p className="faint text-sm" data-testid="labels-readonly">
          Only an Owner or Admin can rename, merge or retire labels. You can see what&apos;s in use.
        </p>
      )}
      {SECTIONS.map(({ kind, title, subtitle, records }) => {
        const rows = sections[kind];
        return (
          <Card lit key={kind}>
            <div data-testid={`labels-${kind}`}>
              <CardHeader
                title={title}
                subtitle={
                  kind === "title"
                    ? `${subtitle} ${sections.titleTotal.toLocaleString()} different titles${rows.length < sections.titleTotal ? `; the ${rows.length.toLocaleString()} most used${titleQuery ? " matching" : ""} shown` : ""}.`
                    : subtitle
                }
              />
              {kind === "title" && (
                <form
                  className="relative px-5 pb-3"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const q = titleSearch.trim();
                    router.push(q ? `/dashboard/labels?title=${encodeURIComponent(q)}` : "/dashboard/labels");
                  }}
                >
                  <IconSearch size={14} className="pointer-events-none absolute left-7.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                  <input
                    type="search"
                    value={titleSearch}
                    onChange={(event) => setTitleSearch(event.target.value)}
                    placeholder="Search job titles…"
                    aria-label="Search job titles"
                    className="input input-sm w-full max-w-xs pl-8"
                    data-testid="labels-title-search"
                  />
                </form>
              )}
              {result?.kind === kind && (
                <div className="px-5 pb-3">
                  {result.error ? (
                    <FormError message={result.text} />
                  ) : (
                    <p className="text-sm text-[var(--ok)]" data-testid="labels-result">
                      {result.text}
                    </p>
                  )}
                </div>
              )}
              {rows.length === 0 ? (
                <p className="faint px-5 pb-5 text-sm">None yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--hairline)]">
                  {rows.map((row) => (
                    <Row
                      key={row.name}
                      kind={kind}
                      row={row}
                      others={rows.filter((other) => other.name !== row.name)}
                      records={records}
                      canManage={canManage}
                      pending={pending}
                      open={open}
                      text={text}
                      setText={setText}
                      setOpen={(key, initial) => {
                        setOpen(key);
                        setText(initial ?? "");
                        setResult(null);
                      }}
                      onRename={(to) => run(kind, () => renameLabelAction({ kind, from: row.name, to }))}
                      onMerge={(into) => run(kind, () => mergeLabelAction({ kind, from: row.name, into }))}
                      onRetire={(retired) => run(kind, () => retireLabelAction({ kind, name: row.name, retired }))}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Row({
  kind,
  row,
  others,
  records,
  canManage,
  pending,
  open,
  text,
  setText,
  setOpen,
  onRename,
  onMerge,
  onRetire,
}: {
  kind: LabelKind;
  row: LabelRow;
  others: LabelRow[];
  records: string;
  canManage: boolean;
  pending: boolean;
  open: string | null;
  text: string;
  setText: (value: string) => void;
  setOpen: (key: string | null, initial?: string) => void;
  onRename: (to: string) => void;
  onMerge: (into: string) => void;
  onRetire: (retired: boolean) => void;
}) {
  const key = `${kind}|${row.name}`;
  const renaming = open === `${key}|rename`;
  const merging = open === `${key}|merge`;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 text-sm" data-testid="label-row" data-name={row.name}>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{row.name}</span>
        {row.builtIn && <span className="badge ml-2 text-[0.62rem]">Built in</span>}
        {row.retired && (
          <span className="badge ml-2 text-[0.62rem] text-[var(--text-faint)]" data-testid="label-retired">
            Retired
          </span>
        )}
        {kind !== "title" && !row.onList && !row.retired && !row.builtIn && (
          <span className="badge ml-2 text-[0.62rem] text-[var(--text-faint)]">Not on the pick list</span>
        )}
        {row.under && row.under.length > 0 && <span className="faint ml-2 text-xs">under {row.under.join(", ")}</span>}
      </span>
      <span className="faint num whitespace-nowrap text-xs" data-testid="label-count">
        {row.count.toLocaleString()} {row.count === 1 ? records.replace(/ies$/, "y").replace(/s$/, "") : records}
      </span>
      {canManage && !row.locked && !renaming && !merging && (
        <span className="flex flex-wrap gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(`${key}|rename`, row.name)} data-testid="label-rename">
            Rename
          </button>
          {others.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(`${key}|merge`, "")} data-testid="label-merge">
              Merge into…
            </button>
          )}
          {kind !== "title" && (row.onList || row.retired) && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onRetire(!row.retired)} data-testid="label-retire">
              {row.retired ? "Restore" : "Retire"}
            </button>
          )}
        </span>
      )}
      {canManage && row.locked && <span className="faint text-xs">{row.builtIn ? "Built in" : "Used by suppliers"}</span>}
      {renaming && (
        <span className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRename(text);
              if (event.key === "Escape") setOpen(null);
            }}
            aria-label={`New name for ${row.name}`}
            autoFocus
            className="input input-sm w-48"
            data-testid="label-rename-input"
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => onRename(text)} data-testid="label-rename-save">
            Save
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
            Cancel
          </button>
        </span>
      )}
      {merging && (
        <span className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <select
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label={`Merge ${row.name} into`}
            className="select input-sm w-52"
            data-testid="label-merge-into"
          >
            <option value="">Merge into…</option>
            {others.map((other) => (
              <option key={other.name} value={other.name}>
                {other.name} ({other.count.toLocaleString()})
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !text} onClick={() => onMerge(text)} data-testid="label-merge-save">
            Merge
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
            Cancel
          </button>
          <span className="faint w-full text-xs">
            Every one of the {row.count.toLocaleString()} {records} with &ldquo;{row.name}&rdquo; gets the one you pick instead, and &ldquo;{row.name}&rdquo; comes off the pick list.
          </span>
        </span>
      )}
    </li>
  );
}
