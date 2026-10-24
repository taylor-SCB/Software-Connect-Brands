"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@/components/icons";
import { createPhotoFolder } from "../../photo-actions";

// "+ New mini folder" at the end of the folder bar. Opens the new folder
// once it exists, so the next photos sent land in it.
export function NewFolderForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  async function create() {
    const result = await createPhotoFolder(projectId, name);
    if (result.error || !result.id) return setError(result.error);
    setOpen(false);
    setName("");
    setError(undefined);
    router.push(`/dashboard/projects/${projectId}/files?folder=${result.id}`);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="folder-new">
        <IconPlus size={12} />
        New mini folder
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void create();
          if (event.key === "Escape") setOpen(false);
        }}
        maxLength={60}
        placeholder="Folder name"
        className="input input-sm w-44"
        data-testid="folder-new-name"
      />
      <button type="button" onClick={() => void create()} className="btn btn-primary btn-sm" data-testid="folder-new-save">
        Create
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
        Cancel
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </span>
  );
}
