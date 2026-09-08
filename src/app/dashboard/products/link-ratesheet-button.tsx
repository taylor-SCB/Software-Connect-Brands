"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconPlus, IconUpload, IconX, IconUsers, IconFileText, IconCheck } from "@/components/icons";
import { FormError } from "@/components/ui";
import { formatCents } from "@/lib/format";
import { TAG_LABELS, UNIT_LABELS } from "@/lib/constants";
import { planImport, CSV_COLUMNS, CSV_COLUMN_LABELS, MAX_IMPORT_ROWS, type ImportPlan } from "@/lib/csv";
import type { ActionState } from "@/lib/forms";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type Choice = "menu" | "upload" | "csv" | "partner";
type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

// The hot-pink "+ Link Ratesheet" button and the dialog behind it. Three
// choices: upload a file, import a CSV as products, or link a distributor
// / partner from inside the system (coming soon).
export function LinkRatesheetButton({
  uploadAction,
  importAction,
}: {
  uploadAction: FormAction;
  importAction: FormAction;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("menu");

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // A finished upload redirects to the Ratesheets page with ?uploaded=<id>.
  // When the upload started *on* that page the component survives the
  // navigation, so the dialog closes itself the render the id lands
  // (state adjusted during render, not in an effect).
  const uploaded = useSearchParams().get("uploaded");
  const [seenUploaded, setSeenUploaded] = useState(uploaded);
  if (uploaded !== seenUploaded) {
    setSeenUploaded(uploaded);
    if (uploaded) setOpen(false);
  }

  function show() {
    setChoice("menu");
    setOpen(true);
  }

  const titles: Record<Choice, string> = {
    menu: "Bring in a distributor's price list",
    upload: "Upload a file",
    csv: "Import products from a CSV",
    partner: "Link Distributor / Partner",
  };

  return (
    <>
      <button type="button" onClick={show} className="btn btn-pink btn-sm">
        <IconPlus size={14} />
        Link Ratesheet
      </button>

      {open && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-ratesheet-title"
            className="card card-lit max-h-[92vh] w-full max-w-2xl overflow-y-auto bg-[#0e1017] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow mb-1">Link Ratesheet</p>
                <h2 id="link-ratesheet-title" className="text-base font-semibold">
                  {titles[choice]}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="btn btn-ghost btn-sm !px-1.5"
              >
                <IconX size={14} />
              </button>
            </div>

            {choice === "menu" && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MenuCard
                  onClick={() => setChoice("upload")}
                  icon={<IconUpload size={16} />}
                  tint="#ff4fae"
                  title="Upload File"
                  blurb="Save a ratesheet from your files, Google Drive or wherever it lives."
                />
                <MenuCard
                  onClick={() => setChoice("csv")}
                  icon={<IconFileText size={16} />}
                  tint="#38bdf8"
                  title="Import CSV"
                  blurb="Turn a spreadsheet of items and prices into products in your catalog."
                />
                <MenuCard
                  onClick={() => setChoice("partner")}
                  icon={<IconUsers size={16} />}
                  tint="var(--brand)"
                  title="Link Distributor / Partner"
                  blurb="Find an active distributor and pull their list straight from the system."
                />
              </div>
            )}

            {choice === "partner" && (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center">
                <p className="text-sm font-semibold">Coming Soon…</p>
                <p className="faint mt-1 text-xs">
                  Searching other workspaces&apos; published ratesheets isn&apos;t live yet.
                </p>
                <button
                  type="button"
                  onClick={() => setChoice("menu")}
                  className="btn btn-ghost btn-sm mt-4"
                >
                  Back
                </button>
              </div>
            )}

            {choice === "upload" && <UploadForm action={uploadAction} onBack={() => setChoice("menu")} />}
            {choice === "csv" && (
              <CsvForm action={importAction} onBack={() => setChoice("menu")} onDone={() => setOpen(false)} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MenuCard({
  onClick,
  icon,
  tint,
  title,
  blurb,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  tint: string;
  title: string;
  blurb: string;
}) {
  return (
    <button type="button" onClick={onClick} className="card card-hover p-4 text-left">
      <div
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint }}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="faint mt-1 text-xs leading-relaxed">{blurb}</p>
    </button>
  );
}

function UploadForm({ action, onBack }: { action: FormAction; onBack: () => void }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [fileName, setFileName] = useState("");
  const [tooBig, setTooBig] = useState(false);

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div>
        <label className="label" htmlFor="ratesheet-file">
          File
        </label>
        <input
          id="ratesheet-file"
          name="file"
          type="file"
          required
          onChange={(event) => {
            const file = event.target.files?.[0];
            setFileName(file?.name ?? "");
            // Checked here so a file over the cap is refused with a message
            // instead of the request bouncing before the server can answer.
            setTooBig(!!file && file.size > MAX_UPLOAD_BYTES);
          }}
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-2)] file:px-2.5 file:py-1 file:text-xs file:text-[var(--text)]"
        />
        <p className="faint mt-1 text-xs">PDF, Excel, CSV or an image — up to 4 MB.</p>
        {tooBig && (
          <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
            That file is over 4 MB. Export a smaller version and try again.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="ratesheet-name">
          Name<span className="faint font-normal"> · optional</span>
        </label>
        <input
          id="ratesheet-name"
          name="name"
          placeholder={fileName ? fileName.replace(/\.[^.]+$/, "") : "Acme Supply — 2026 price list"}
          className="input"
        />
        <p className="faint mt-1 text-xs">How it shows up under Ratesheets. Defaults to the file name.</p>
      </div>

      <FormError message={state?.error} />

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending || tooBig} className="btn btn-pink btn-sm">
          <IconUpload size={13} />
          {pending ? "Uploading…" : "Upload"}
        </button>
        <button type="button" onClick={onBack} className="btn btn-ghost btn-sm">
          Back
        </button>
      </div>
    </form>
  );
}

// Reads the file in the browser to show exactly what the server will do,
// then sends the same file up; the server runs the same parser.
function CsvForm({
  action,
  onBack,
  onDone,
}: {
  action: FormAction;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [tooBig, setTooBig] = useState(false);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPlan(null);
    setPlanError("");
    setTooBig(false);
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setTooBig(true);
      return;
    }
    const planned = planImport(await file.text());
    if (planned.ok) setPlan(planned.plan);
    else setPlanError(planned.error);
  }

  if (state?.success) {
    return (
      <div className="mt-4 space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-4 py-3">
          <IconCheck size={16} className="mt-0.5 shrink-0 text-[var(--ok)]" />
          <div>
            <p className="text-sm font-semibold">{state.success}</p>
            <p className="faint mt-1 text-xs">They&apos;re in your Products list now.</p>
          </div>
        </div>
        <button type="button" onClick={onDone} className="btn btn-primary btn-sm">
          Done
        </button>
      </div>
    );
  }

  const matched = CSV_COLUMNS.filter((column) => plan?.columns[column] !== undefined);
  const missing = CSV_COLUMNS.filter((column) => plan?.columns[column] === undefined);
  const rowsWithNotes = plan?.rows.filter((row) => row.notes.length > 0) ?? [];

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div>
        <label className="label" htmlFor="import-file">
          CSV file
        </label>
        <input
          id="import-file"
          name="file"
          type="file"
          accept=".csv,text/csv,text/plain"
          required
          onChange={onFile}
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-2)] file:px-2.5 file:py-1 file:text-xs file:text-[var(--text)]"
        />
        <p className="faint mt-1 text-xs">
          First row is headers. Name is required; SKU, Description, Unit price, COGS, Manufacturer, Unit
          and Tag are picked up when present. Up to 4 MB and {MAX_IMPORT_ROWS.toLocaleString()} rows.{" "}
          <a href="/dashboard/products/import-template" download className="link">
            Download a template
          </a>
          .
        </p>
        {tooBig && (
          <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
            That file is over 4 MB. Split it and try again.
          </p>
        )}
        <FormError message={planError} />
      </div>

      {plan && (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
          <p className="text-sm font-semibold" data-testid="import-summary">
            {plan.rows.length.toLocaleString()} {plan.rows.length === 1 ? "product" : "products"} found
            {plan.skippedBlankName > 0 && ` · ${plan.skippedBlankName} without a name skipped`}
            {plan.skippedDuplicates > 0 &&
              ` · ${plan.skippedDuplicates} duplicate${plan.skippedDuplicates === 1 ? "" : "s"} skipped`}
            {plan.truncated > 0 && ` · only the first ${MAX_IMPORT_ROWS.toLocaleString()} will import`}
          </p>
          <p className="faint text-xs">
            Matched:{" "}
            {matched.map((column) => `${CSV_COLUMN_LABELS[column]} ← "${plan.headers[plan.columns[column]!]}"`).join(", ")}
            {missing.length > 0 && ` · Not in file: ${missing.map((column) => CSV_COLUMN_LABELS[column]).join(", ")}`}
          </p>
          <p className="faint text-xs">
            A row whose SKU (or name) already exists updates that product instead of adding a second one.
          </p>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>SKU</th>
                  <th className="text-right">COGS</th>
                  <th className="text-right">Unit price</th>
                  <th>Tag</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, 5).map((row) => (
                  <tr key={row.line}>
                    <td className="max-w-[14rem] truncate">{row.name}</td>
                    <td className="num faint text-xs">{row.sku ?? "—"}</td>
                    {/* A blank cell leaves an existing product's value alone,
                        so it shows as blank here rather than as $0.00. */}
                    <td className="num text-right">{row.present.cost ? formatCents(row.costCents) : "—"}</td>
                    <td className="num text-right">{row.present.price ? formatCents(row.unitPriceCents) : "—"}</td>
                    <td className="text-xs">{TAG_LABELS[row.defaultTag]}</td>
                    <td className="text-xs">{row.unitOfMeasure ? UNIT_LABELS[row.unitOfMeasure] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.rows.length > 5 && (
            <p className="faint text-xs">…and {(plan.rows.length - 5).toLocaleString()} more.</p>
          )}

          {rowsWithNotes.length > 0 && (
            <div className="text-xs">
              <p className="font-medium text-[var(--warn)]">
                {rowsWithNotes.length} {rowsWithNotes.length === 1 ? "row needs" : "rows need"} a look
                (they still import):
              </p>
              <ul className="faint mt-1 list-disc space-y-0.5 pl-4">
                {rowsWithNotes.slice(0, 4).map((row) => (
                  <li key={row.line}>
                    Line {row.line}: {row.notes.join("; ")}
                  </li>
                ))}
                {rowsWithNotes.length > 4 && <li>…and {rowsWithNotes.length - 4} more.</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <FormError message={state?.error} />

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending || tooBig || !plan} className="btn btn-pink btn-sm">
          <IconFileText size={13} />
          {pending ? "Importing…" : plan ? `Import ${plan.rows.length.toLocaleString()} products` : "Import"}
        </button>
        <button type="button" onClick={onBack} className="btn btn-ghost btn-sm">
          Back
        </button>
      </div>
    </form>
  );
}
