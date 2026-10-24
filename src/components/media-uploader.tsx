"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { FormError } from "@/components/ui";
import { IconCheck, IconUpload } from "@/components/icons";
import { PhotoTagPicker } from "@/components/photo-tag-picker";
import type { PhotoAccess } from "@/lib/job-photos";
import type { PhotoTagOption } from "@/lib/photo-tags";
import { addPhotoTag, finishPhotoUpload, startPhotoUpload } from "@/app/dashboard/projects/photo-actions";

type Row = { id: number; name: string; percent: number; state: "waiting" | "sending" | "done" | "failed"; error?: string };

// Phones don't always say what a video is. The extension does.
const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
};

function typeOf(file: File) {
  return file.type || BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
}

// The local store takes a plain PUT; XHR because fetch can't report how
// far an upload has got, and a video on one bar needs a progress bar.
function putLocal(key: string, ticket: string, file: File, type: string, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/storage/local?t=${encodeURIComponent(ticket)}`);
    request.setRequestHeader("Content-Type", type);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress((event.loaded / event.total) * 100);
    request.onload = () => (request.status < 300 ? resolve() : reject(new Error(request.responseText || "Upload failed")));
    request.onerror = () => reject(new Error("Lost the connection. Try again when you have signal."));
    request.send(file);
  });
}

// Take or choose photos and videos and they go, tagged with whatever is
// ticked (nothing ticked is General Project). One at a time, so a weak
// signal finishes something rather than nothing. The Files tab, an
// editor's link and an installer's crew link all use it; the server
// decides from `access` who is sending and where the photos land.
export function MediaUploader({
  access,
  folderId = null,
  tags: initialTags,
  askName = false,
  canAddTags = true,
  testId = "media",
}: {
  access: PhotoAccess;
  folderId?: string | null;
  tags: PhotoTagOption[];
  askName?: boolean;
  canAddTags?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState(initialTags);
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function update(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  // The installer's name, remembered on their phone for the next job.
  function rememberedName(input: HTMLInputElement | null) {
    whoRef.current = input;
    if (!input || input.value) return;
    try {
      input.value = window.localStorage.getItem("crew-photo-name") ?? "";
    } catch {}
  }

  async function addTag(kind: PhotoTagOption["kind"], name: string) {
    const result = await addPhotoTag(access, kind, name);
    if (!("error" in result)) setTags((current) => (current.some((tag) => tag.id === result.id) ? current : [...current, result]));
    return result;
  }

  async function send(files: File[]) {
    const who = whoRef.current?.value.trim() ?? "";
    setError(undefined);
    if (askName && !who) return setError("Put your name in first so the office knows who sent them.");
    if (askName) {
      try {
        window.localStorage.setItem("crew-photo-name", who);
      } catch {}
    }

    const base = Date.now();
    const queued = files.map((file, index) => ({ id: base + index, file }));
    setRows((current) => [
      ...queued.map(({ id, file }) => ({ id, name: file.name, percent: 0, state: "waiting" as const })),
      ...current,
    ]);
    setBusy(true);

    for (const { id, file } of queued) {
      update(id, { state: "sending" });
      const type = typeOf(file);
      try {
        const started = await startPhotoUpload(access, { name: file.name, type, size: file.size }, folderId);
        if ("error" in started) throw new Error(started.error);
        const onProgress = (percent: number) => update(id, { percent });
        if (started.driver === "local") {
          await putLocal(started.key, started.ticket, file, type, onProgress);
        } else {
          await upload(started.key, file, {
            access: "private",
            handleUploadUrl: "/api/storage/upload",
            clientPayload: started.ticket,
            contentType: type,
            multipart: file.size > 50 * 1024 * 1024,
            onUploadProgress: ({ percentage }) => onProgress(percentage),
          });
        }
        const done = await finishPhotoUpload(access, started.ticket, {
          fileName: file.name,
          uploadedByName: who || undefined,
          tagIds: selected,
        });
        if (done.error) throw new Error(done.error);
        update(id, { state: "done", percent: 100 });
      } catch (caught) {
        update(id, { state: "failed", error: caught instanceof Error ? caught.message : "Upload failed" });
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  const sent = rows.filter((row) => row.state === "done").length;

  return (
    <div className="space-y-4" data-testid={`${testId}-uploader`}>
      {askName && (
        <div>
          <label className="label" htmlFor={`${testId}-who`}>Your name</label>
          <input
            id={`${testId}-who`}
            ref={rememberedName}
            className="input"
            autoComplete="name"
            maxLength={80}
            data-testid={`${testId}-who`}
          />
        </div>
      )}

      <PhotoTagPicker
        tags={tags}
        selected={selected}
        onChange={setSelected}
        onAdd={canAddTags ? addTag : undefined}
        testId={`${testId}-tags`}
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        id={`${testId}-files`}
        data-testid={`${testId}-files`}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void send(files);
        }}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => {
          if (askName && !whoRef.current?.value.trim()) return setError("Put your name in first so the office knows who sent them.");
          setError(undefined);
          inputRef.current?.click();
        }}
        disabled={busy}
        className="btn btn-primary w-full justify-center py-4 text-base"
        data-testid={`${testId}-pick`}
      >
        <IconUpload size={18} />
        {busy ? "Sending…" : "Add photos & videos"}
      </button>

      <FormError message={error} />

      {rows.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {sent > 0 && (
            <p className="text-sm font-medium text-[var(--ok)]" data-testid={`${testId}-sent-count`}>
              <IconCheck size={14} className="inline" /> {sent} sent
            </p>
          )}
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.id} className="text-xs" data-testid={`${testId}-row`} data-state={row.state}>
                <div className="flex justify-between gap-2">
                  <span className="truncate">{row.name}</span>
                  <span className={row.state === "failed" ? "text-[var(--danger)]" : "faint"}>
                    {row.state === "done"
                      ? "Sent"
                      : row.state === "failed"
                        ? "Didn't send"
                        : row.state === "waiting"
                          ? "Waiting"
                          : `${Math.round(row.percent)}%`}
                  </span>
                </div>
                {row.state === "sending" && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-[rgb(255_255_255/0.08)]">
                    <div className="h-full bg-[var(--brand)]" style={{ width: `${row.percent}%` }} />
                  </div>
                )}
                {row.error && <p className="mt-0.5 text-[var(--danger)]">{row.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
