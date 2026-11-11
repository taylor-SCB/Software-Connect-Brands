"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { CONTACT_CSV_LABELS, type ContactCsvColumn, type ContactImportPlan } from "@/lib/contacts-csv";
import { findFileDuplicates } from "@/lib/import-duplicates";
import {
  checkImportDuplicates,
  importAssistAvailable,
  suggestImportHeaders,
  type ExistingMatch,
  type HeaderSuggestion,
} from "@/app/dashboard/contacts/import-assist-actions";

const CHECK_BATCH = 1000;

// The contacts import's clean-up, in the preview (Nov 10, 2026): likely
// duplicates inside the file and against contacts already on file (no AI),
// and, with AI on, where the columns the planner left out probably go.
// Accepting a column re-plans the preview; nothing is saved until Import.
export function ImportCleanup({
  plan,
  onMap,
}: {
  plan: ContactImportPlan;
  // Re-plan with these headers placed by hand, column → header index.
  onMap: (mapped: Partial<Record<ContactCsvColumn, number>>) => void;
}) {
  const inFile = useMemo(
    () =>
      findFileDuplicates(
        plan.rows.map((row) => ({ line: row.line, name: row.name, email: row.email, phone: row.phone, mobile: row.mobile, company: row.company?.name ?? null })),
      ),
    [plan],
  );

  const [existing, setExisting] = useState<{ plan: ContactImportPlan; matches: ExistingMatch[]; done: boolean; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const people = plan.rows.filter((row) => row.name);
      const matches: ExistingMatch[] = [];
      for (let start = 0; start < people.length; start += CHECK_BATCH) {
        const batch = people.slice(start, start + CHECK_BATCH).map((row) => ({
          line: row.line,
          name: row.name,
          email: row.email,
          phones: [row.phone, row.mobile].filter((value): value is string => Boolean(value)),
          company: row.company?.name ?? null,
        }));
        let result: Awaited<ReturnType<typeof checkImportDuplicates>>;
        try {
          result = await checkImportDuplicates(batch);
        } catch {
          result = { error: "Couldn't check against your contacts just now." };
        }
        if (!live) return;
        if ("error" in result) {
          setExisting({ plan, matches, done: true, error: result.error });
          return;
        }
        matches.push(...result.matches);
        setExisting({ plan, matches: [...matches], done: start + CHECK_BATCH >= people.length });
      }
      if (live) setExisting({ plan, matches, done: true });
    })();
    return () => {
      live = false;
    };
  }, [plan]);
  const current = existing?.plan === plan ? existing : null;
  const realDuplicates = current?.matches.filter((match) => !match.updates) ?? [];
  const updates = current?.matches.filter((match) => match.updates) ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3 text-xs" data-testid="import-cleanup">
      <div data-testid="import-duplicates">
        <p className="font-medium">
          Possible duplicates:{" "}
          <span data-testid="import-dup-file-count">{inFile.length}</span> in this file
          {current ? (
            <>
              {" · "}
              <span data-testid="import-dup-existing-count">{realDuplicates.length}</span> like contacts you already have
              {!current.done && " (still checking…)"}
            </>
          ) : (
            " · checking against your contacts…"
          )}
        </p>
        {current?.error && <p className="text-[var(--danger)]">{current.error}</p>}
        {(inFile.length > 0 || realDuplicates.length > 0) && (
          <ul className="faint mt-1 list-disc space-y-0.5 pl-4" data-testid="import-dup-list">
            {inFile.slice(0, 5).map((group) => (
              <li key={`f-${group.lines.join("-")}`}>
                Lines {group.lines.join(", ")}: {[...new Set(group.names)].join(" / ")} — {group.reason}
              </li>
            ))}
            {inFile.length > 5 && <li>…and {inFile.length - 5} more in the file.</li>}
            {realDuplicates.slice(0, 5).map((match) => (
              <li key={`e-${match.line}`}>
                Line {match.line} looks like{" "}
                <a href={`/dashboard/contacts/${match.contactId}`} target="_blank" rel="noreferrer" className="link">
                  {match.contactName}
                </a>{" "}
                — {match.reason}. It would be added as a second contact.
              </li>
            ))}
            {realDuplicates.length > 5 && <li>…and {realDuplicates.length - 5} more already on file.</li>}
          </ul>
        )}
        {updates.length > 0 && (
          <p className="faint mt-1" data-testid="import-dup-updates">
            {updates.length.toLocaleString()} {updates.length === 1 ? "row matches a contact" : "rows match contacts"} already on file (the same email, or the same name at the same company) and will update {updates.length === 1 ? "it" : "them"}.
          </p>
        )}
        {(inFile.length > 0 || realDuplicates.length > 0) && (
          <p className="faint mt-1">They still import as they are. Fix them in the file and pick it again, or merge them afterwards with Merge Contacts.</p>
        )}
      </div>
      <HeaderHints plan={plan} onMap={onMap} />
    </div>
  );
}

function HeaderHints({ plan, onMap }: { plan: ContactImportPlan; onMap: (mapped: Partial<Record<ContactCsvColumn, number>>) => void }) {
  const [ai, setAi] = useState(false);
  const [result, setResult] = useState<{ plan: ContactImportPlan; suggestions: HeaderSuggestion[] } | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    importAssistAvailable()
      .then((answer) => live && setAi(answer.ai))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const claimed = new Set(Object.values(plan.columns));
  const unused = plan.headers.map((header, index) => ({ header, index })).filter((row) => row.header && !claimed.has(row.index));
  if (!ai || unused.length === 0) return null;
  const suggestions = result?.plan === plan ? result.suggestions : null;

  function ask() {
    setError(null);
    start(async () => {
      const answer = await suggestImportHeaders({
        headers: unused.slice(0, 30).map((row) => ({
          index: row.index,
          header: row.header.slice(0, 120),
          samples: (plan.samples ?? []).map((cells) => cells[row.index] ?? "").filter(Boolean).slice(0, 3),
        })),
        taken: Object.keys(plan.columns),
      });
      if ("error" in answer) {
        setError(answer.error);
        return;
      }
      setResult({ plan, suggestions: answer.suggestions });
      setTicked(answer.suggestions.map((row) => row.index));
    });
  }

  return (
    <div data-testid="import-header-hints">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{unused.length === 1 ? "1 column is" : `${unused.length} columns are`} left out.</p>
        <button type="button" onClick={ask} disabled={pending} className="btn btn-ghost btn-sm" data-testid="import-suggest-headers">
          <IconSparkles size={12} />
          {pending ? "Looking…" : "Suggest where they go"}
        </button>
      </div>
      {error && (
        <p className="mt-1 text-[var(--danger)]" data-testid="import-headers-error">
          {error}
        </p>
      )}
      {suggestions && suggestions.length === 0 && <p className="faint mt-1">The AI didn&apos;t find a place for them.</p>}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {suggestions.map((row) => (
            <label key={row.index} className="flex items-start gap-2" data-testid="import-header-suggestion" data-header={row.header}>
              <input
                type="checkbox"
                checked={ticked.includes(row.index)}
                onChange={() => setTicked((list) => (list.includes(row.index) ? list.filter((value) => value !== row.index) : [...list, row.index]))}
                className="mt-0.5 accent-[var(--brand)]"
              />
              <span>
                &ldquo;{row.header}&rdquo; → <strong>{CONTACT_CSV_LABELS[row.column]}</strong>
                <span className="faint"> · {row.reason}</span>
              </span>
            </label>
          ))}
          <button
            type="button"
            disabled={ticked.length === 0}
            onClick={() => {
              const mapped: Partial<Record<ContactCsvColumn, number>> = {};
              for (const row of suggestions) if (ticked.includes(row.index)) mapped[row.column] = row.index;
              onMap(mapped);
            }}
            className="btn btn-primary btn-sm"
            data-testid="import-apply-headers"
          >
            Use ticked columns
          </button>
        </div>
      )}
    </div>
  );
}
