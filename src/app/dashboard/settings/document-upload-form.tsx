"use client";

import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconUpload, IconSparkles } from "@/components/icons";
import { COMPLIANCE_CATEGORIES } from "@/lib/constants";
import { pictureForAi, readPdf } from "@/lib/redline-file";
import { limitsText } from "@/lib/compliance-shared";
import { uploadDocument } from "./actions";
import { readComplianceDoc } from "./compliance-actions";
import type { ActionState } from "@/lib/forms";

// Mirrors MAX_DOCUMENT_BYTES in src/lib/uploads.ts: refuse a big file
// before the request is even sent.
const MAX_BYTES = 4 * 1024 * 1024;

const BLANK = { name: "", category: "W-9", expiresOn: "", namedInsured: "", insurer: "", policyNumber: "", limits: "" };

// Upload one file to Compliance (with a category, an expiry and what the
// file says) or to Marketing (just a name). Release B: on Compliance,
// "Read it for me" fills the fields from the file for the person to check
// before Upload; on a subcontractor's crew card, `crewId` files it there.
// Sent without a page reset (onSubmit hands the same form data to the
// action in a transition), so a refused upload keeps what was typed.
export function DocumentUploadForm({
  kind,
  aiOn = false,
  crewId,
  idPrefix,
}: {
  kind: "COMPLIANCE" | "MARKETING";
  aiOn?: boolean;
  crewId?: string;
  idPrefix?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(uploadDocument, {});
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [fields, setFields] = useState(BLANK);
  const [readByAi, setReadByAi] = useState(false);
  const [reading, startReading] = useTransition();
  const [readNote, setReadNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const prefix = idPrefix ?? kind;
  const compliance = kind === "COMPLIANCE";

  // A save that went through clears the form for the next file. Done as
  // state adjusted during render, against the state object (two saves in
  // a row report the same words), and the file box is cleared by a new key.
  const [seenState, setSeenState] = useState(state);
  const [fileKey, setFileKey] = useState(0);
  if (seenState !== state) {
    setSeenState(state);
    if (state?.success) {
      setFields(BLANK);
      setReadByAi(false);
      setReadNote(null);
      setFileKey((key) => key + 1);
    }
  }

  const set = (key: keyof typeof BLANK) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFields((all) => ({ ...all, [key]: event.target.value }));

  function readIt() {
    const file = fileRef.current?.files?.[0];
    setReadError(null);
    setReadNote(null);
    if (!file) {
      setReadError("Choose the file first.");
      return;
    }
    startReading(async () => {
      try {
        const form = new FormData();
        if (crewId) form.set("crewId", crewId);
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          if (file.size > MAX_BYTES) throw new Error("That file is over 4 MB. Export a smaller version and try again.");
          const pdf = await readPdf(file, 20_000);
          if ("error" in pdf) throw new Error(pdf.error);
          form.set("file", new Blob([file], { type: "application/pdf" }), file.name);
          form.set("text", pdf.text);
        } else if (file.type.startsWith("image/")) {
          form.set("file", await pictureForAi(file, 1568, 0.8), "document.jpg");
        } else {
          throw new Error("The reader takes a PDF or a photo of the document.");
        }
        const read = await readComplianceDoc(form);
        startReading(() => {
          if ("error" in read) {
            setReadError(read.error);
            return;
          }
          setFields({
            name: read.name || fields.name,
            category: read.category,
            expiresOn: read.expiresOn,
            namedInsured: read.namedInsured,
            insurer: read.insurer,
            policyNumber: read.policyNumber,
            limits: limitsText(read.limits),
          });
          setReadByAi(true);
          const parts = [
            read.fromPicture ? "Read from a picture: check every field against the document." : "Filled in from the file. Check them, then Upload.",
            read.dropped.length ? `Left blank because the file doesn't say it: ${read.dropped.join(", ")}.` : "",
            read.nameMismatch ? `The named insured isn't ${read.nameMismatch}.` : "",
          ].filter(Boolean);
          setReadNote({ tone: read.nameMismatch || read.dropped.length || read.fromPicture ? "warn" : "ok", text: parts.join(" ") });
        });
      } catch (problem) {
        const message = problem instanceof Error ? problem.message : "That file couldn't be read.";
        startReading(() => setReadError(message));
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 p-5"
      data-testid={`document-upload-${prefix}`}
      onSubmit={(event) => {
        const file = fileRef.current?.files?.[0];
        if (file && file.size > MAX_BYTES) {
          event.preventDefault();
          alert("That file is over 4 MB. Export a smaller version and try again.");
          return;
        }
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      {crewId && <input type="hidden" name="crewId" value={crewId} />}
      <input type="hidden" name="readByAi" value={readByAi ? "1" : ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor={`${prefix}-file`}>
            File
          </label>
          <input
            key={fileKey}
            ref={fileRef}
            id={`${prefix}-file`}
            name="file"
            type="file"
            required
            onChange={() => {
              setReadNote(null);
              setReadError(null);
            }}
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-[var(--tint-4)] file:px-2 file:py-1 file:text-xs file:text-[var(--text)]"
            data-testid="document-file"
          />
          <p className="faint mt-1 text-xs">PDF, image or document, up to 4 MB.</p>
          {compliance && aiOn && (
            <button
              type="button"
              onClick={readIt}
              disabled={reading || pending}
              className="btn btn-ghost btn-sm mt-2 min-h-11 sm:min-h-0"
              data-testid="compliance-read"
            >
              <IconSparkles size={13} />
              {reading ? "Reading it…" : "Read it for me"}
            </button>
          )}
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-name`}>
            Name
          </label>
          <input
            id={`${prefix}-name`}
            name="name"
            value={fields.name}
            onChange={set("name")}
            placeholder={compliance ? "2026 W-9" : "Spring brochure"}
            className="input"
          />
          <p className="faint mt-1 text-xs">Leave blank to use the file&apos;s name.</p>
        </div>
        {compliance && (
          <>
            <div>
              <label className="label" htmlFor={`${prefix}-category`}>
                Type
              </label>
              <select id={`${prefix}-category`} name="category" className="select" value={fields.category} onChange={set("category")}>
                {COMPLIANCE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`${prefix}-expiresOn`}>
                Expires
              </label>
              <input
                id={`${prefix}-expiresOn`}
                name="expiresOn"
                type="date"
                value={fields.expiresOn}
                onChange={set("expiresOn")}
                className="input"
                data-testid="compliance-expires"
              />
              <p className="faint mt-1 text-xs">A COI or license runs out; the list flags it when it does.</p>
            </div>
            <div>
              <label className="label" htmlFor={`${prefix}-namedInsured`}>
                Named insured
              </label>
              <input id={`${prefix}-namedInsured`} name="namedInsured" value={fields.namedInsured} onChange={set("namedInsured")} className="input" data-testid="compliance-named" />
            </div>
            <div>
              <label className="label" htmlFor={`${prefix}-insurer`}>
                Insurer or issued by
              </label>
              <input id={`${prefix}-insurer`} name="insurer" value={fields.insurer} onChange={set("insurer")} className="input" data-testid="compliance-insurer" />
            </div>
            <div>
              <label className="label" htmlFor={`${prefix}-policyNumber`}>
                Policy or license number
              </label>
              <input id={`${prefix}-policyNumber`} name="policyNumber" value={fields.policyNumber} onChange={set("policyNumber")} className="input" data-testid="compliance-policy" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor={`${prefix}-limits`}>
                Coverage limits
              </label>
              <textarea
                id={`${prefix}-limits`}
                name="limits"
                rows={3}
                value={fields.limits}
                onChange={set("limits")}
                placeholder={"Each occurrence: $1,000,000\nGeneral aggregate: $2,000,000"}
                className="input"
                data-testid="compliance-limits"
              />
            </div>
          </>
        )}
      </div>

      {readNote && (
        <p role="status" className={`text-xs ${readNote.tone === "warn" ? "text-[var(--warn)]" : "text-[var(--ok)]"}`} data-testid="compliance-read-note">
          {readNote.text}
        </p>
      )}
      <FormError message={readError ?? undefined} />
      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary btn-sm min-h-11 sm:min-h-0" data-testid="document-upload">
        <IconUpload size={13} />
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
