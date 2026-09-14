"use client";

import { useActionState, useRef } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconUpload } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { PROJECT_FILE_CATEGORIES } from "@/lib/constants";
import { uploadProjectFile } from "../../actions";

// Mirrors MAX_DOCUMENT_BYTES in src/lib/uploads.ts: refuse a big file
// before the request is even sent.
const MAX_BYTES = 4 * 1024 * 1024;

export function ProjectFileForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(uploadProjectFile, {});
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
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="project-file">File</label>
          <input
            id="project-file"
            ref={fileRef}
            type="file"
            name="file"
            required
            className="input"
            data-testid="project-file-input"
          />
        </div>
        <div>
          <label className="label" htmlFor="project-file-name">
            Call it
            <span className="faint font-normal"> · optional</span>
          </label>
          <input
            id="project-file-name"
            name="name"
            placeholder="The file's own name"
            className="input"
            data-testid="project-file-name"
          />
        </div>
        <div>
          <label className="label" htmlFor="project-file-category">What it is</label>
          <select
            id="project-file-category"
            name="category"
            className="select"
            defaultValue="Other"
            data-testid="project-file-category"
          >
            {PROJECT_FILE_CATEGORIES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="faint text-xs">
        Signed the other party&apos;s paper instead of yours? Upload their copy as a{" "}
        <strong className="font-medium">Signed contract</strong> and it lives with the job.
      </p>
      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />
      <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="project-file-upload">
        <IconUpload size={13} />
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
