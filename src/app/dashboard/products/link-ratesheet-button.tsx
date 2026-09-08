"use client";

import { useActionState, useEffect, useState } from "react";
import { IconPlus, IconUpload, IconX, IconUsers } from "@/components/icons";
import { FormError } from "@/components/ui";
import type { ActionState } from "@/lib/forms";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type Choice = "menu" | "upload" | "partner";

// The hot-pink "+ Link Ratesheet" button and the dialog behind it. Two
// choices: upload a file (works today) or link a distributor / partner
// from inside the system (coming soon).
export function LinkRatesheetButton({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
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

  function show() {
    setChoice("menu");
    setOpen(true);
  }

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
            className="card card-lit w-full max-w-lg bg-[#0e1017] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow mb-1">Link Ratesheet</p>
                <h2 id="link-ratesheet-title" className="text-base font-semibold">
                  {choice === "upload" ? "Upload a file" : "Bring in a distributor's price list"}
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
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setChoice("upload")}
                  className="card card-hover p-4 text-left"
                >
                  <div
                    className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{ background: "rgb(255 31 143 / 0.16)", color: "#ff4fae" }}
                  >
                    <IconUpload size={16} />
                  </div>
                  <p className="text-sm font-semibold">Upload File</p>
                  <p className="faint mt-1 text-xs leading-relaxed">
                    Load a ratesheet from your files, Google Drive or wherever it lives.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setChoice("partner")}
                  className="card card-hover p-4 text-left"
                >
                  <div
                    className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{
                      background: "color-mix(in srgb, var(--brand) 14%, transparent)",
                      color: "var(--brand)",
                    }}
                  >
                    <IconUsers size={16} />
                  </div>
                  <p className="text-sm font-semibold">Link Distributor / Partner</p>
                  <p className="faint mt-1 text-xs leading-relaxed">
                    Find an active distributor and pull their list straight from the system.
                  </p>
                </button>
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

            {choice === "upload" && <UploadForm action={action} onBack={() => setChoice("menu")} />}
          </div>
        </div>
      )}
    </>
  );
}

function UploadForm({
  action,
  onBack,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  onBack: () => void;
}) {
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
