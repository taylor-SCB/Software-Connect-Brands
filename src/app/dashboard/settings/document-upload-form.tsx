"use client";

import { useActionState, useRef } from "react";
import { Field, FormError, FormSuccess } from "@/components/ui";
import { IconUpload } from "@/components/icons";
import { COMPLIANCE_CATEGORIES } from "@/lib/constants";
import { uploadDocument } from "./actions";
import type { ActionState } from "@/lib/forms";

// Mirrors MAX_DOCUMENT_BYTES in src/lib/uploads.ts: refuse a big file
// before the request is even sent.
const MAX_BYTES = 4 * 1024 * 1024;

// Upload one file to Compliance (with a category and an expiry) or to
// Marketing (just a name).
export function DocumentUploadForm({ kind }: { kind: "COMPLIANCE" | "MARKETING" }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    uploadDocument,
    {},
  );
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={formAction}
      className="space-y-4 p-5"
      onSubmit={(event) => {
        const file = fileRef.current?.files?.[0];
        if (file && file.size > MAX_BYTES) {
          event.preventDefault();
          alert("That file is over 4 MB. Export a smaller version and try again.");
        }
      }}
    >
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${kind}-file`}>
            File
          </label>
          <input
            ref={fileRef}
            id={`${kind}-file`}
            name="file"
            type="file"
            required
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-[rgb(255_255_255/0.08)] file:px-2 file:py-1 file:text-xs file:text-[var(--text)]"
          />
          <p className="faint mt-1 text-xs">PDF, image or document, up to 4 MB.</p>
        </div>
        <Field
          label="Name"
          name="name"
          placeholder={kind === "COMPLIANCE" ? "2026 W-9" : "Spring brochure"}
          hint="Leave blank to use the file's name."
        />
        {kind === "COMPLIANCE" && (
          <>
            <div>
              <label className="label" htmlFor="category">
                Type
              </label>
              <select id="category" name="category" className="select" defaultValue="W-9">
                {COMPLIANCE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Expires"
              name="expiresOn"
              type="date"
              hint="A COI or license runs out; the list flags it when it does."
            />
          </>
        )}
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
        <IconUpload size={13} />
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
