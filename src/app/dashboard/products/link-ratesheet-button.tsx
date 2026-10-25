"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { IconPlus, IconUpload, IconX, IconUsers, IconFileText } from "@/components/icons";
import { FormError } from "@/components/ui";
import type { ActionState } from "@/lib/forms";
import { ImportRatesheet, type RatesheetSupplier } from "./import-ratesheet";
import type { PlatformSupplier } from "@/lib/account-types";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type Choice = "menu" | "upload" | "csv" | "partner";
type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

// The hot-pink "+ Link Ratesheet" button and the dialog behind it. Three
// choices: upload a file, import a supplier's ratesheet into the catalog
// (their price is your cost, their MSRP is kept), or link a distributor /
// partner from inside the system (coming soon).
export function LinkRatesheetButton({
  uploadAction,
  suppliers,
  platformSuppliers = [],
}: {
  uploadAction: FormAction;
  suppliers: RatesheetSupplier[];
  platformSuppliers?: PlatformSupplier[];
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
    csv: "Import Ratesheet",
    partner: "Link Distributor / Partner",
  };

  return (
    <>
      <button type="button" onClick={show} className="btn btn-pink btn-sm">
        <IconPlus size={14} />
        Link Ratesheet
      </button>

      {/* On document.body, so the scrim and the dialog are placed against the
          screen, not against whatever page section the button sits in. */}
      {open &&
        createPortal(
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
              className={`card card-lit popover max-h-[92vh] w-full overflow-y-auto p-5 ${choice === "csv" ? "max-w-4xl" : "max-w-2xl"}`}
            >
              <div className="sticky -top-5 z-10 -mx-5 -mt-5 flex items-start justify-between gap-3 bg-[var(--overlay)] px-5 pb-2 pt-5">
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
                    title="Import Ratesheet"
                    blurb="Their price becomes your cost, their MSRP is kept, and your markup sets the sell price."
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
                <ImportRatesheet
                  suppliers={suppliers}
                  platformSuppliers={platformSuppliers}
                  onBack={() => setChoice("menu")} onDone={() => setOpen(false)} />
              )}
            </div>
          </div>,
          document.body,
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
