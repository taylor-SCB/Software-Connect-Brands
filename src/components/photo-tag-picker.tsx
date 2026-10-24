"use client";

import { useState } from "react";
import { IconPlus } from "@/components/icons";
import type { PhotoTagOption } from "@/lib/photo-tags";

const ROWS = [
  { kind: "TYPE", label: "Photo type" },
  { kind: "LOCATION", label: "Location / Area" },
] as const;

// The two tag rows on job photos: tap to tick, tap again to untick, and
// "+ Add" for one that isn't on the list yet. Used when sending photos and
// when changing a photo's tags; `onAdd` is absent where nobody may add.
export function PhotoTagPicker({
  tags,
  selected,
  onChange,
  onAdd,
  testId = "tags",
}: {
  tags: PhotoTagOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onAdd?: (kind: PhotoTagOption["kind"], name: string) => Promise<PhotoTagOption | { error: string }>;
  testId?: string;
}) {
  const [adding, setAdding] = useState<PhotoTagOption["kind"] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id]);
  }

  async function add(kind: PhotoTagOption["kind"]) {
    if (!onAdd || !draft.trim()) return;
    const result = await onAdd(kind, draft);
    if ("error" in result) return setError(result.error);
    setError(undefined);
    setDraft("");
    setAdding(null);
    if (!selected.includes(result.id)) onChange([...selected, result.id]);
  }

  return (
    <div className="space-y-3" data-testid={testId}>
      {ROWS.map((row) => (
        <div key={row.kind}>
          <p className="label">
            {row.label}
            <span className="faint font-normal"> · optional</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tags
              .filter((tag) => tag.kind === row.kind)
              .map((tag) => {
                const on = selected.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(tag.id)}
                    className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
                    data-testid={`${testId}-tag`}
                    data-name={tag.name}
                  >
                    {tag.name}
                  </button>
                );
              })}
            {onAdd && adding !== row.kind && (
              <button
                type="button"
                onClick={() => {
                  setAdding(row.kind);
                  setDraft("");
                  setError(undefined);
                }}
                className="btn btn-ghost btn-sm faint"
                data-testid={`${testId}-add-${row.kind.toLowerCase()}`}
              >
                <IconPlus size={12} />
                Add
              </button>
            )}
          </div>
          {onAdd && adding === row.kind && (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void add(row.kind);
                  }
                }}
                maxLength={60}
                placeholder={row.kind === "TYPE" ? "e.g. Punch list" : "e.g. Boiler room"}
                className="input input-sm min-w-0 flex-1"
                data-testid={`${testId}-new-${row.kind.toLowerCase()}`}
              />
              <button type="button" onClick={() => void add(row.kind)} className="btn btn-primary btn-sm">
                Add
              </button>
              <button type="button" onClick={() => setAdding(null)} className="btn btn-ghost btn-sm">
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
