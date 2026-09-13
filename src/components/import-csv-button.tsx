"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconUpload, IconX, IconCheck, IconDownload } from "@/components/icons";
import { FormError } from "@/components/ui";
import {
  planContactImport,
  emptyBatchResult,
  addBatchResult,
  skippedCsv,
  IMPORT_BATCH_SIZE,
  CONTACT_CSV_COLUMNS,
  CONTACT_CSV_LABELS,
  type ContactImportPlan,
  type ImportBatchResult,
} from "@/lib/contacts-csv";
import { importContactsBatch } from "@/app/dashboard/contacts/import-actions";

// "Import CSV" on the Contacts and Companies lists. The browser reads the
// whole file (any size), shows what it found, then sends the rows up in
// batches of a few hundred with a running count. Closing the tab stops
// it; re-uploading the same file carries on without doubling anything,
// because rows that already exist are updated, not added again.
export function ImportCsvButton({ kind }: { kind: "contacts" | "companies" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="import-csv">
        <IconUpload size={14} />
        Import CSV
      </button>
      {open && <ImportDialog kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}

type Phase =
  | { step: "pick" }
  | { step: "reading" }
  | { step: "preview"; plan: ContactImportPlan }
  | { step: "running"; plan: ContactImportPlan; done: number; totals: ImportBatchResult }
  | { step: "finished"; plan: ContactImportPlan; done: number; totals: ImportBatchResult; stopped: boolean; error?: string };

function ImportDialog({ kind, onClose }: { kind: "contacts" | "companies"; onClose: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  const [planError, setPlanError] = useState("");
  const stopRef = useRef(false);
  const running = phase.step === "running";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !running) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPlanError("");
    if (!file) return;
    setPhase({ step: "reading" });
    // Let the "Reading…" state paint before the parse takes the thread.
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    try {
      const planned = planContactImport(await file.text());
      if (planned.ok) setPhase({ step: "preview", plan: planned.plan });
      else {
        setPlanError(planned.error);
        setPhase({ step: "pick" });
      }
    } catch {
      setPlanError("That file couldn't be read. Save it as CSV and try again.");
      setPhase({ step: "pick" });
    }
  }

  async function run(plan: ContactImportPlan) {
    stopRef.current = false;
    const totals = emptyBatchResult();
    let done = 0;
    setPhase({ step: "running", plan, done, totals: { ...totals, skipped: [...totals.skipped] } });
    for (let start = 0; start < plan.rows.length; start += IMPORT_BATCH_SIZE) {
      if (stopRef.current) break;
      const batch = plan.rows.slice(start, start + IMPORT_BATCH_SIZE).map((row) => ({ ...row, notes: undefined }));
      let result: Awaited<ReturnType<typeof importContactsBatch>>;
      try {
        result = await importContactsBatch(batch);
      } catch {
        result = { error: "The connection dropped. Re-upload the same file to carry on where this left off." };
      }
      if ("error" in result) {
        setPhase({ step: "finished", plan, done, totals, stopped: true, error: result.error });
        router.refresh();
        return;
      }
      addBatchResult(totals, result);
      done = Math.min(plan.rows.length, start + IMPORT_BATCH_SIZE);
      setPhase({ step: "running", plan, done, totals: { ...totals, skipped: [...totals.skipped] } });
    }
    setPhase({ step: "finished", plan, done, totals, stopped: stopRef.current });
    router.refresh();
  }

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import CSV"
        onClick={(event) => event.stopPropagation()}
        className="card card-lit flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">Import {kind}</h2>
            <p className="faint mt-0.5 text-xs">
              One spreadsheet, any size. Contacts and their companies come in together.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close" className="btn btn-ghost btn-sm">
            <IconX size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {(phase.step === "pick" || phase.step === "reading") && (
            <div className="space-y-3">
              <label className="label" htmlFor="import-file">
                CSV file
              </label>
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={onFile}
                disabled={phase.step === "reading"}
                data-testid="import-file"
                className="input file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-2)] file:px-2.5 file:py-1 file:text-xs file:text-[var(--text)]"
              />
              <p className="faint text-xs">
                First row is headers. Only <strong>Name</strong> or <strong>Company Name</strong> is required; Title,
                Email, Phone, Website, City, State, Birthday, Status, the company&apos;s details, Industry and Company
                Type are picked up when present. First name and Last name columns are joined.{" "}
                <a href="/dashboard/contacts/import-template" download className="link">
                  Download the template
                </a>
                .
              </p>
              {phase.step === "reading" && <p className="text-xs">Reading the file…</p>}
              <FormError message={planError} />
            </div>
          )}

          {phase.step === "preview" && <Preview plan={phase.plan} />}

          {(phase.step === "running" || phase.step === "finished") && (
            <Progress
              plan={phase.plan}
              done={phase.done}
              totals={phase.totals}
              finished={phase.step === "finished"}
              stopped={phase.step === "finished" && phase.stopped}
              error={phase.step === "finished" ? phase.error : undefined}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-2">
            {phase.step === "preview" && (
              <>
                <button type="button" onClick={() => run(phase.plan)} className="btn btn-primary btn-sm" data-testid="import-start">
                  <IconUpload size={13} />
                  Import {phase.plan.rows.length.toLocaleString()} {phase.plan.rows.length === 1 ? "row" : "rows"}
                </button>
                <button type="button" onClick={() => setPhase({ step: "pick" })} className="btn btn-ghost btn-sm">
                  Pick a different file
                </button>
              </>
            )}
            {phase.step === "running" && (
              <button type="button" onClick={() => (stopRef.current = true)} className="btn btn-ghost btn-sm">
                Stop after this batch
              </button>
            )}
            {phase.step === "finished" && (
              <button type="button" onClick={onClose} className="btn btn-primary btn-sm" data-testid="import-done">
                Done
              </button>
            )}
          </div>
          {phase.step === "finished" && phase.totals.skipped.length > 0 && (
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(skippedCsv(phase.totals.skipped))}`}
              download="skipped-rows.csv"
              className="btn btn-ghost btn-sm"
            >
              <IconDownload size={13} />
              Download skipped rows
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Preview({ plan }: { plan: ContactImportPlan }) {
  const matched = CONTACT_CSV_COLUMNS.filter((column) => plan.columns[column] !== undefined);
  const rowsWithNotes = plan.rows.filter((row) => row.notes.length > 0);
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold" data-testid="import-summary">
        {plan.contactRows.toLocaleString()} {plan.contactRows === 1 ? "contact" : "contacts"} and{" "}
        {plan.companiesNamed.toLocaleString()} {plan.companiesNamed === 1 ? "company" : "companies"} found
        {plan.companyOnlyRows > 0 && ` · ${plan.companyOnlyRows.toLocaleString()} rows are a company with no person`}
        {plan.skippedEmpty > 0 && ` · ${plan.skippedEmpty.toLocaleString()} empty rows skipped`}
        {plan.skippedDuplicates > 0 && ` · ${plan.skippedDuplicates.toLocaleString()} duplicates skipped`}
      </p>
      <p className="faint text-xs">
        Matched: {matched.map((column) => `${CONTACT_CSV_LABELS[column]} ← "${plan.headers[plan.columns[column]!]}"`).join(", ")}
      </p>
      <p className="faint text-xs">
        A company that already exists is reused and only its blank details are filled in. A contact whose email
        already exists is updated instead of added twice. A contact with no company counts as Individual / Personal.
      </p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Company</th>
              <th>Industry · Type</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.slice(0, 6).map((row) => (
              <tr key={row.line}>
                <td className="max-w-[12rem] truncate">{row.name ?? <span className="faint">(company only)</span>}</td>
                <td className="faint max-w-[12rem] truncate text-xs">{row.email ?? "—"}</td>
                <td className="num text-xs">{row.phone ?? "—"}</td>
                <td className="max-w-[12rem] truncate">{row.company?.name ?? <span className="faint">—</span>}</td>
                <td className="text-xs">{[...(row.company?.industries ?? []), ...(row.company?.companyTypes ?? [])].join(", ") || "—"}</td>
                <td className="text-xs">{row.state ?? row.company?.state ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.rows.length > 6 && <p className="faint text-xs">…and {(plan.rows.length - 6).toLocaleString()} more.</p>}
      {rowsWithNotes.length > 0 && (
        <div className="text-xs">
          <p className="font-medium text-[var(--warn)]">
            {rowsWithNotes.length.toLocaleString()} {rowsWithNotes.length === 1 ? "row needs" : "rows need"} a look (they still import):
          </p>
          <ul className="faint mt-1 list-disc space-y-0.5 pl-4">
            {rowsWithNotes.slice(0, 4).map((row) => (
              <li key={row.line}>
                Line {row.line}: {row.notes.join("; ")}
              </li>
            ))}
            {rowsWithNotes.length > 4 && <li>…and {(rowsWithNotes.length - 4).toLocaleString()} more.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Progress({
  plan,
  done,
  totals,
  finished,
  stopped,
  error,
}: {
  plan: ContactImportPlan;
  done: number;
  totals: ImportBatchResult;
  finished: boolean;
  stopped: boolean;
  error?: string;
}) {
  const percent = plan.rows.length === 0 ? 100 : Math.round((done / plan.rows.length) * 100);
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium" data-testid="import-progress">
            {finished
              ? stopped
                ? `Stopped after ${done.toLocaleString()} of ${plan.rows.length.toLocaleString()} rows`
                : `Imported ${plan.rows.length.toLocaleString()} rows`
              : `Importing… ${done.toLocaleString()} of ${plan.rows.length.toLocaleString()} rows`}
          </span>
          <span className="num faint">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[rgb(255_255_255/0.08)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--brand)] transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        {!finished && <p className="faint mt-1 text-xs">Keep this tab open. Stopping early is fine; re-upload the same file to finish.</p>}
      </div>

      {finished && !error && (
        <div className="flex items-start gap-3 rounded-xl border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-4 py-3">
          <IconCheck size={16} className="mt-0.5 shrink-0 text-[var(--ok)]" />
          <p className="text-sm font-semibold">They&apos;re in your lists now.</p>
        </div>
      )}
      <FormError message={error} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-testid="import-totals">
        <Stat label="Contacts added" value={totals.contactsCreated} />
        <Stat label="Contacts updated" value={totals.contactsUpdated} />
        <Stat label="Companies added" value={totals.companiesCreated} />
        <Stat label="Companies updated" value={totals.companiesUpdated} />
      </dl>
      {totals.skipped.length > 0 && (
        <p className="text-xs text-[var(--warn)]">
          {totals.skipped.length.toLocaleString()} {totals.skipped.length === 1 ? "row" : "rows"} skipped — download the list below to fix and reload them.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="faint text-xs">{label}</dt>
      <dd className="num text-lg font-semibold">{value.toLocaleString()}</dd>
    </div>
  );
}
