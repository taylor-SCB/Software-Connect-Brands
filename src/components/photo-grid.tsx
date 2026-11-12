"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PhotoTagPicker } from "@/components/photo-tag-picker";
import { IconDownload, IconSparkles, IconTag, IconTrash, IconX } from "@/components/icons";
import { PunchListButton } from "@/components/punch-list";
import type { TagSuggestionView } from "@/lib/photo-tag-suggestions";
import { fetchPicture, pictureForAi } from "@/lib/ai-picture";
import { acceptTagSuggestions, dismissTagSuggestion, suggestPhotoTags } from "@/app/dashboard/projects/photo-ai-actions";
import type { PhotoAccess } from "@/lib/job-photos";
import type { PhotoTagOption } from "@/lib/photo-tags";
import { addPhotoTag, deletePhoto, placePhoto, setPhotoTags } from "@/app/dashboard/projects/photo-actions";

export type PhotoItem = {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  src: string;
  sentBy: string | null;
  sentOn: string;
  tagIds: string[];
};

// Browsers other than Safari can't draw an iPhone's HEIC, so those show
// as a tile that downloads rather than a broken picture.
function drawable(mimeType: string) {
  return mimeType.startsWith("image/") && !/hei[cf]/.test(mimeType);
}

// A job's photos as square tiles, each with who sent it, when, and its
// tags. Tag chips across the top filter the grid, Photo Type and Location
// stacking. What a viewer can do is passed in: staff tag, move, clone and
// delete; an editor tags; a look-only link only looks.
export function PhotoGrid({
  items,
  tags: initialTags,
  access,
  canTag = false,
  staff,
  ai = null,
}: {
  items: PhotoItem[];
  tags: PhotoTagOption[];
  access: PhotoAccess;
  canTag?: boolean;
  staff?: { projectId: string; folderId: string | null; folders: { id: string; name: string }[] };
  // Release C (Nov 12, 2026), staff with AI on: each photo's stored tag
  // suggestions (dashed chips to accept), and the crew-link photos to ask
  // about now (`auto`), since nobody in the app has opened them yet.
  ai?: { suggestions: Record<string, TagSuggestionView>; auto: string[] } | null;
}) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  // Select mode (staff): pick photos for Suggest tags, Accept all or the
  // punch list.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [aiBusy, startAi] = useTransition();
  const [aiNote, setAiNote] = useState<{ text: string; error?: boolean } | null>(null);
  const autoRan = useRef(false);

  // Crew-link photos get their suggestions the first time someone in the
  // app opens the job (Taylor's call 2's link, Release C). One request a
  // photo; the server's claim row means a second tab asks nothing.
  useEffect(() => {
    if (!ai || !staff || autoRan.current || ai.auto.length === 0) return;
    autoRan.current = true;
    const wanted = items.filter((item) => ai.auto.includes(item.id));
    if (!wanted.length) return;
    void (async () => {
      setAiNote({ text: `Suggesting tags for ${wanted.length} new crew ${wanted.length === 1 ? "photo" : "photos"}…` });
      let error = "";
      for (const item of wanted) {
        try {
          const base64 = await pictureForAi(await fetchPicture(item.src));
          const result = await suggestPhotoTags(staff.projectId, item.id, base64);
          if ("error" in result) error = result.error;
        } catch (caught) {
          error = caught instanceof Error ? caught.message : "A photo couldn't be read.";
        }
      }
      setAiNote(error ? { text: `Tag suggestions: ${error}`, error: true } : { text: "Tag suggestions are on the crew's photos. Tap one to add it." });
      router.refresh();
    })();
  }, [ai, staff, items, router]);

  function suggestPicked() {
    if (!staff) return;
    const wanted = items.filter((item) => picked.includes(item.id) && drawable(item.mimeType));
    if (!wanted.length) return setAiNote({ text: "Pick photos first (videos are skipped).", error: true });
    startAi(async () => {
      let error = "";
      let done = 0;
      for (const item of wanted) {
        setAiNote({ text: `Suggesting tags… ${done + 1} of ${wanted.length}` });
        try {
          const base64 = await pictureForAi(await fetchPicture(item.src));
          const result = await suggestPhotoTags(staff.projectId, item.id, base64, true);
          if ("error" in result) error = result.error;
        } catch (caught) {
          error = caught instanceof Error ? caught.message : "A photo couldn't be read.";
        }
        done += 1;
      }
      startAi(() => setAiNote(error ? { text: error, error: true } : { text: `Suggestions are on ${wanted.length} ${wanted.length === 1 ? "photo" : "photos"}.` }));
      router.refresh();
    });
  }

  function accept(uploadIds: string[], parts: ("type" | "location" | "new")[]) {
    if (!staff) return;
    startAi(async () => {
      const result = await acceptTagSuggestions(
        staff.projectId,
        uploadIds.map((uploadId) => ({ uploadId, parts })),
      );
      startAi(() =>
        setAiNote(
          result.error
            ? { text: result.error, error: true }
            : uploadIds.length > 1
              ? { text: `Added ${result.accepted} ${result.accepted === 1 ? "tag" : "tags"}.` }
              : null,
        ),
      );
      router.refresh();
    });
  }

  function dismiss(uploadId: string, part: "type" | "location" | "new") {
    if (!staff) return;
    startAi(async () => {
      await dismissTagSuggestion(staff.projectId, uploadId, part);
      router.refresh();
    });
  }
  const [filter, setFilter] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ item: PhotoItem; mode: "move" | "clone" } | null>(null);

  // Only tags some photo here actually has are worth filtering by.
  const used = tags.filter((tag) => items.some((item) => item.tagIds.includes(tag.id)));
  const shown = items.filter((item) =>
    (["TYPE", "LOCATION"] as const).every((kind) => {
      const picked = filter.filter((id) => tags.find((tag) => tag.id === id)?.kind === kind);
      return picked.length === 0 || picked.some((id) => item.tagIds.includes(id));
    }),
  );

  async function addTag(kind: PhotoTagOption["kind"], name: string) {
    const result = await addPhotoTag(access, kind, name);
    if (!("error" in result)) setTags((current) => (current.some((tag) => tag.id === result.id) ? current : [...current, result]));
    return result;
  }

  if (items.length === 0) {
    return <p className="faint py-6 text-center text-sm" data-testid="photo-grid-empty">No photos or videos here yet.</p>;
  }

  const pickedWithSuggestions = picked.filter((id) => {
    const each = ai?.suggestions[id];
    return each && (each.type || each.location || each.newLabel);
  });

  return (
    <div className="space-y-4" data-testid="photo-grid">
      {staff && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="photo-select-bar">
          <button
            type="button"
            onClick={() => {
              setSelecting(!selecting);
              setPicked([]);
            }}
            aria-pressed={selecting}
            className={`btn btn-sm ${selecting ? "btn-primary" : "btn-ghost"}`}
            data-testid="photo-select"
          >
            {selecting ? "Done" : "Select"}
          </button>
          {selecting && (
            <>
              <button type="button" onClick={() => setPicked(picked.length === shown.length ? [] : shown.map((item) => item.id))} className="btn btn-ghost btn-sm" data-testid="photo-select-all">
                {picked.length === shown.length ? "Clear" : "Select all"}
              </button>
              <span className="faint text-xs" data-testid="photo-picked-count">
                {picked.length} picked
              </span>
              {ai && (
                <>
                  <button type="button" onClick={suggestPicked} disabled={aiBusy || picked.length === 0} className="btn btn-ghost btn-sm" data-testid="photo-suggest">
                    <IconSparkles size={13} />
                    Suggest tags
                  </button>
                  <button
                    type="button"
                    onClick={() => accept(pickedWithSuggestions, ["type", "location", "new"])}
                    disabled={aiBusy || pickedWithSuggestions.length === 0}
                    className="btn btn-ghost btn-sm"
                    data-testid="photo-accept-all"
                  >
                    Accept all
                  </button>
                  {picked.length > 0 && (
                    <PunchListButton projectId={staff.projectId} picked={picked} label="Check these against the scope" testId="photo-punch" />
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      {aiNote && (
        <p className={`text-xs ${aiNote.error ? "text-[var(--danger)]" : "faint"}`} role="status" data-testid="photo-ai-note">
          {aiNote.text}
        </p>
      )}
      {used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="photo-filters">
          <span className="faint mr-1 text-xs">Show</span>
          {used.map((tag) => {
            const on = filter.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(on ? filter.filter((id) => id !== tag.id) : [...filter, tag.id])}
                className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
                data-testid="photo-filter"
                data-name={tag.name}
              >
                {tag.name}
              </button>
            );
          })}
          {filter.length > 0 && (
            <button type="button" onClick={() => setFilter([])} className="btn btn-ghost btn-sm faint">
              Clear
            </button>
          )}
          <span className="faint ml-auto text-xs" data-testid="photo-count">
            {shown.length} of {items.length}
          </span>
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((item) => (
          <li
            key={item.id}
            className={`relative flex min-w-0 flex-col overflow-hidden rounded-lg border ${picked.includes(item.id) ? "border-[var(--brand)] ring-2 ring-[var(--brand)]" : "border-[var(--border)]"}`}
            data-testid="media-item"
            data-name={item.fileName}
            data-id={item.id}
          >
            {selecting && (
              <label className="absolute left-1 top-1 z-10 flex h-11 w-11 items-center justify-center rounded-md bg-[var(--overlay)]">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={picked.includes(item.id)}
                  onChange={(event) => setPicked(event.target.checked ? [...picked, item.id] : picked.filter((id) => id !== item.id))}
                  aria-label={`Pick ${item.name}`}
                  data-testid="media-pick"
                />
              </label>
            )}
            {item.mimeType.startsWith("video/") ? (
              <video src={item.src} controls preload="metadata" playsInline className="aspect-square w-full bg-black object-cover" />
            ) : drawable(item.mimeType) ? (
              <a href={item.src} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.src} alt={item.name} loading="lazy" className="aspect-square w-full object-cover" />
              </a>
            ) : (
              <a href={item.src} className="faint flex aspect-square w-full items-center justify-center gap-1 text-xs">
                <IconDownload size={16} /> {item.fileName}
              </a>
            )}

            <div className="flex flex-1 flex-col gap-1.5 px-2 py-2">
              <p className="faint text-[0.7rem] leading-snug" data-testid="media-meta">
                {item.sentBy && <span className="block truncate font-medium text-[var(--text)]">{item.sentBy}</span>}
                {item.sentOn}
              </p>
              <div className="flex flex-wrap gap-1" data-testid="media-tags">
                {tags
                  .filter((tag) => item.tagIds.includes(tag.id))
                  .map((tag) => (
                    <span
                      key={tag.id}
                      className={`rounded px-1.5 py-0.5 text-[0.65rem] ${tag.kind === "TYPE" ? "bg-[color-mix(in_srgb,var(--brand)_25%,transparent)]" : "bg-[var(--tint-4)]"}`}
                    >
                      {tag.name}
                    </span>
                  ))}
              </div>
              {ai && staff && (
                <SuggestionChips
                  suggestion={ai.suggestions[item.id]}
                  busy={aiBusy}
                  onAccept={(part) => accept([item.id], [part])}
                  onDismiss={(part) => dismiss(item.id, part)}
                />
              )}

              {editing === item.id ? (
                <TagEditor
                  item={item}
                  tags={tags}
                  access={access}
                  onAdd={addTag}
                  onDone={() => setEditing(null)}
                />
              ) : (
                (canTag || staff) && (
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    {canTag && (
                      <button type="button" onClick={() => setEditing(item.id)} className="btn btn-ghost btn-sm !px-1.5" data-testid="media-edit-tags">
                        <IconTag size={12} />
                        Tags
                      </button>
                    )}
                    {staff && (
                      <>
                        <button type="button" onClick={() => setPlacing({ item, mode: "move" })} className="btn btn-ghost btn-sm !px-1.5" data-testid="media-move">
                          Move
                        </button>
                        <button type="button" onClick={() => setPlacing({ item, mode: "clone" })} className="btn btn-ghost btn-sm !px-1.5" data-testid="media-clone">
                          Clone
                        </button>
                        <form action={deletePhoto} className="ml-auto">
                          <input type="hidden" name="uploadId" value={item.id} />
                          <button type="submit" aria-label={`Delete ${item.name}`} className="btn btn-ghost btn-sm !px-1.5" data-testid="delete-media">
                            <IconTrash size={12} />
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          </li>
        ))}
      </ul>

      {placing && staff && (
        <PlaceDialog
          item={placing.item}
          mode={placing.mode}
          projectId={staff.projectId}
          currentFolderId={staff.folderId}
          folders={staff.folders}
          onClose={() => setPlacing(null)}
        />
      )}
    </div>
  );
}

// A stored suggestion as dashed chips: tap to add that tag, × to say no.
// A new label reads "New:" and is only made when tapped.
function SuggestionChips({
  suggestion,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: TagSuggestionView | undefined;
  busy: boolean;
  onAccept: (part: "type" | "location" | "new") => void;
  onDismiss: (part: "type" | "location" | "new") => void;
}) {
  if (!suggestion) return null;
  const chips = [
    suggestion.type ? { part: "type" as const, label: suggestion.type.name } : null,
    suggestion.location ? { part: "location" as const, label: suggestion.location.name } : null,
    suggestion.newLabel ? { part: "new" as const, label: `New: ${suggestion.newLabel.name}` } : null,
  ].filter((chip): chip is { part: "type" | "location" | "new"; label: string } => chip !== null);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="media-suggestions">
      <span className="sr-only">Suggested tags:</span>
      {chips.map((chip) => (
        <span key={chip.part} className="inline-flex items-stretch rounded border border-dashed border-[var(--border-strong)] text-[0.7rem]" data-testid="media-suggestion" data-part={chip.part} data-name={chip.label}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept(chip.part)}
            className="min-h-11 px-1.5 hover:bg-[var(--hover)] lg:min-h-7"
            title="Add this tag"
            data-testid="media-suggestion-accept"
          >
            + {chip.label}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDismiss(chip.part)}
            aria-label={`Dismiss ${chip.label}`}
            className="faint min-h-11 min-w-8 border-l border-dashed border-[var(--border-strong)] px-1 hover:bg-[var(--hover)] lg:min-h-7 lg:min-w-6"
            data-testid="media-suggestion-dismiss"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function TagEditor({
  item,
  tags,
  access,
  onAdd,
  onDone,
}: {
  item: PhotoItem;
  tags: PhotoTagOption[];
  access: PhotoAccess;
  onAdd: (kind: PhotoTagOption["kind"], name: string) => Promise<PhotoTagOption | { error: string }>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(item.tagIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setSaving(true);
    const result = await setPhotoTags(access, item.id, selected);
    setSaving(false);
    if (result.error) return setError(result.error);
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-2 border-t border-[var(--hairline-3)] pt-2" data-testid="media-tag-editor">
      <PhotoTagPicker tags={tags} selected={selected} onChange={setSelected} onAdd={onAdd} testId="edit-tags" />
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex gap-1">
        <button type="button" onClick={save} disabled={saving} className="btn btn-primary btn-sm" data-testid="media-save-tags">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// "Move" or "Clone": tick one or more mini folders (or the main folder,
// when the photo is in a mini one), or name a new one.
function PlaceDialog({
  item,
  mode,
  projectId,
  currentFolderId,
  folders,
  onClose,
}: {
  item: PhotoItem;
  mode: "move" | "clone";
  projectId: string;
  currentFolderId: string | null;
  folders: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const options = [
    ...(currentFolderId ? [{ id: "main", name: "Main folder" }] : []),
    ...folders.filter((folder) => folder.id !== currentFolderId),
  ];

  async function submit() {
    setBusy(true);
    const result = await placePhoto(projectId, item.id, mode, picked, newName);
    setBusy(false);
    if (result.error) return setError(result.error);
    onClose();
    router.refresh();
  }

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  // On document.body: a glass card's blur would otherwise pin a fixed
  // overlay inside the card instead of over the screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="card popover w-full max-w-md space-y-4 p-5" data-testid="place-dialog">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="eyebrow">{mode === "move" ? "Move" : "Clone"}</p>
            <h2 className="text-base font-semibold">{item.name}</h2>
            <p className="faint text-xs">
              {mode === "move" ? "Takes it out of this folder." : "Leaves it here and puts a copy in each folder you pick."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm !px-1.5">
            <IconX size={14} />
          </button>
        </div>

        {options.length > 0 && (
          <ul className="space-y-1.5">
            {options.map((folder) => (
              <li key={folder.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.includes(folder.id)}
                    onChange={(event) =>
                      setPicked(event.target.checked ? [...picked, folder.id] : picked.filter((id) => id !== folder.id))
                    }
                    data-testid="place-folder"
                    data-name={folder.name}
                  />
                  {folder.name}
                </label>
              </li>
            ))}
          </ul>
        )}

        <div>
          <label className="label" htmlFor="place-new-folder">Create Mini Folder</label>
          <input
            id="place-new-folder"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={60}
            placeholder="e.g. Punch list, For the owner"
            className="input"
            data-testid="place-new-folder"
          />
        </div>

        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <button type="button" onClick={submit} disabled={busy} className="btn btn-primary w-full justify-center" data-testid="place-submit">
          {busy ? "Working…" : mode === "move" ? "Move" : "Clone"}
        </button>
      </div>
    </div>,
    document.body,

  );
}
