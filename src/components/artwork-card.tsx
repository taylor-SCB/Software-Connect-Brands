"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { putStoredFile } from "@/lib/blob-put";
import {
  checkArtworkNow,
  finishArtworkUpload,
  removeArtworkAction,
  renameArtwork,
  startArtworkUpload,
} from "@/app/dashboard/artwork/actions";
import {
  ArtworkProblem,
  artworkNameFrom,
  readArtworkFile,
  readArtworkPicture,
  type ArtworkPictures,
} from "@/lib/artwork-file";
import type { ArtworkOwner, ArtworkView } from "@/lib/artwork";

// The apparel pack (Nov 12, 2026): a customer's logos, on their company page
// (or, for a customer with no company, in the proof sheet). Each tile is the
// logo on a checkerboard, so a white logo shows; its name and ink note;
// the printer's file to download; a warning when it looks like a famous
// brand's logo (never a block; Taylor, Nov 12).

export const CHECKERBOARD =
  "repeating-conic-gradient(var(--tint-3) 0% 25%, transparent 0% 50%) 50% / 16px 16px";

function sizeText(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Sends one piece of artwork: its pictures and the printer's file. Shared by
// the card and the proof sheet. Returns the new artwork's id.
export async function sendArtwork(input: {
  owner: ArtworkOwner;
  pictures: ArtworkPictures;
  print: File;
  name: string;
  inkNote: string;
}): Promise<{ id: string } | { error: string }> {
  const started = await startArtworkUpload({
    owner: input.owner,
    previewType: input.pictures.type,
    printName: input.print.name,
    printSize: input.print.size,
  });
  if ("error" in started) return { error: started.error };
  const bodies: Record<string, Blob> = {
    preview: input.pictures.preview,
    thumb: input.pictures.thumb,
    check: input.pictures.check,
    print: input.print,
  };
  try {
    for (const file of started.files) await putStoredFile(started.driver, file.key, file.ticket, bodies[file.role], file.type);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The artwork didn't arrive. Add it again." };
  }
  const finished = await finishArtworkUpload({
    owner: input.owner,
    tickets: started.files.map((file) => file.ticket),
    name: input.name,
    inkNote: input.inkNote || null,
    width: input.pictures.width,
    height: input.pictures.height,
    printName: input.print.name,
  });
  if ("error" in finished) return { error: finished.error };
  // The look-alike check runs on its own: the tile shows straight away.
  void checkArtworkNow(finished.id).catch(() => null);
  return { id: finished.id };
}

type Pending = { print: File; pictures: ArtworkPictures | null; why: string | null };

// "+ Add artwork": pick the file, then name it and say its ink colours. A
// file a browser can't draw asks for a PNG or JPEG of it too.
export function AddArtwork({
  owner,
  onAdded,
  compact = false,
}: {
  owner: ArtworkOwner;
  onAdded: (id: string) => void;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pictureRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [name, setName] = useState("");
  const [inkNote, setInkNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("Reading the file…");
    try {
      const read = await readArtworkFile(file);
      setPending(
        read.kind === "ready"
          ? { print: read.print, pictures: read.pictures, why: null }
          : { print: read.print, pictures: null, why: read.why },
      );
      setName(artworkNameFrom(file.name));
    } catch (problem) {
      setError(problem instanceof ArtworkProblem ? problem.message : "That file couldn't be read.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function pickPicture(file: File | undefined) {
    if (!file || !pending) return;
    setError(null);
    setBusy("Reading the picture…");
    try {
      const pictures = await readArtworkPicture(file);
      setPending({ ...pending, pictures });
    } catch (problem) {
      setError(problem instanceof ArtworkProblem ? problem.message : "That picture couldn't be read.");
    } finally {
      setBusy(null);
      if (pictureRef.current) pictureRef.current.value = "";
    }
  }

  async function save() {
    if (!pending?.pictures) return;
    setError(null);
    setBusy("Adding…");
    const result = await sendArtwork({ owner, pictures: pending.pictures, print: pending.print, name: name.trim() || "Artwork", inkNote: inkNote.trim() });
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPending(null);
    setName("");
    setInkNote("");
    onAdded(result.id);
  }

  return (
    <div className={compact ? "" : "border-t border-[var(--hairline-3)] px-5 py-4"} data-testid="artwork-add">
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        accept=".ai,.eps,.pdf,.svg,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.psd,.ps,.cdr,image/*,application/pdf"
        onChange={(event) => pickFile(event.target.files?.[0])}
        data-testid="artwork-file"
        aria-label="Artwork file"
      />
      <input
        ref={pictureRef}
        type="file"
        className="sr-only"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => pickPicture(event.target.files?.[0])}
        data-testid="artwork-picture-file"
        aria-label="A PNG or JPEG of the artwork"
      />
      {!pending ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)} data-testid="artwork-add-button">
          {busy ?? "+ Add artwork"}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{pending.print.name}</span>{" "}
            <span className="faint num">· {sizeText(pending.print.size)} · kept as sent for the printer</span>
          </p>
          {!pending.pictures && (
            <div className="rounded-lg border border-[var(--warn)] px-3 py-2 text-sm" data-testid="artwork-needs-picture">
              <p>{pending.why} Add a PNG or JPEG of the same logo, so it can be put on proofs.</p>
              <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => pictureRef.current?.click()} disabled={Boolean(busy)}>
                {busy ?? "Add a PNG or JPEG"}
              </button>
            </div>
          )}
          {pending.pictures && (
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-lg" style={{ background: CHECKERBOARD }}>
              <BlobImage blob={pending.pictures.thumb} />
            </div>
          )}
          <label className="block text-sm">
            <span className="label">Name</span>
            <input className="input mt-1" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="artwork-name" />
          </label>
          <label className="block text-sm">
            <span className="label">Ink colors (for the printer)</span>
            <input
              className="input mt-1"
              value={inkNote}
              maxLength={120}
              placeholder="2 colors: navy, gold"
              onChange={(event) => setInkNote(event.target.value)}
              data-testid="artwork-ink"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!pending.pictures || Boolean(busy)} data-testid="artwork-save">
              {busy ?? "Add artwork"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)} disabled={Boolean(busy)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert" data-testid="artwork-error">
          {error}
        </p>
      )}
    </div>
  );
}

function BlobImage({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="max-h-full max-w-full object-contain" data-testid="artwork-pending-thumb" />;
}

export function ArtworkTile({ artwork, size = 96 }: { artwork: Pick<ArtworkView, "id" | "name">; size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: CHECKERBOARD, width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/dashboard/artwork/${artwork.id}/picture?v=thumb`} alt={artwork.name} className="max-h-full max-w-full object-contain" loading="lazy" />
    </div>
  );
}

export function ArtworkWarning({ artwork }: { artwork: Pick<ArtworkView, "checkStatus" | "checkNote"> }) {
  if (artwork.checkStatus !== "famous" && artwork.checkStatus !== "unsure") return null;
  return (
    <p className="mt-1 text-xs text-[var(--warn)]" data-testid="artwork-warning">
      {artwork.checkNote ?? "May be a famous brand's logo."} Make sure you&apos;re allowed to print it.
    </p>
  );
}

export function ArtworkCard({
  owner,
  artworks,
  storageOn,
}: {
  owner: ArtworkOwner;
  artworks: ArtworkView[];
  storageOn: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", inkNote: "" });
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ error?: string } | { ok: true }>, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="card card-lit" data-testid="artwork-card">
      <div className="border-b border-[var(--hairline-3)] px-5 py-3.5">
        <h2 className="text-sm font-semibold">Artwork</h2>
        <p className="faint mt-0.5 text-xs">Their logos, for proofs. The printer&apos;s file is kept exactly as sent.</p>
      </div>
      {artworks.length === 0 ? (
        <p className="faint px-5 py-4 text-sm">No artwork yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline-3)]">
          {artworks.map((artwork) => (
            <li key={artwork.id} className="flex gap-3 px-5 py-3" data-testid="artwork-row" data-name={artwork.name}>
              <ArtworkTile artwork={artwork} size={72} />
              <div className="min-w-0 flex-1">
                {editing === artwork.id ? (
                  <div className="space-y-2">
                    <input className="input" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Name" data-testid="artwork-rename-name" />
                    <input className="input" value={draft.inkNote} maxLength={120} placeholder="Ink colors" onChange={(event) => setDraft({ ...draft, inkNote: event.target.value })} aria-label="Ink colors" data-testid="artwork-rename-ink" />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={pending}
                        onClick={() => run(() => renameArtwork(artwork.id, draft.name, draft.inkNote || null), () => setEditing(null))}
                        data-testid="artwork-rename-save"
                      >
                        Save
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium">{artwork.name}</p>
                    {artwork.inkNote && <p className="faint truncate text-xs">{artwork.inkNote}</p>}
                    <p className="faint text-xs">
                      {artwork.printName ? (
                        <a href={`/dashboard/artwork/${artwork.id}/print`} className="link" download data-testid="artwork-download">
                          Download {artwork.printFormat?.toUpperCase() ?? "file"}
                        </a>
                      ) : (
                        "No printer's file"
                      )}
                      {artwork.printSize ? <span className="num"> · {sizeText(artwork.printSize)}</span> : null}
                    </p>
                    <ArtworkWarning artwork={artwork} />
                    {artwork.checkStatus === "unchecked" && <p className="faint mt-1 text-xs">Not checked for a famous brand&apos;s logo.</p>}
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setEditing(artwork.id);
                          setDraft({ name: artwork.name, inkNote: artwork.inkNote ?? "" });
                        }}
                        data-testid="artwork-rename"
                      >
                        Rename
                      </button>
                      {confirm === artwork.id ? (
                        <span className="inline-flex gap-2">
                          <span>Remove it?</span>
                          <button type="button" className="link" onClick={() => setConfirm(null)}>
                            No
                          </button>
                          <button
                            type="button"
                            className="link text-[var(--danger)]"
                            disabled={pending}
                            onClick={() => run(() => removeArtworkAction(artwork.id), () => setConfirm(null))}
                            data-testid="artwork-remove-yes"
                          >
                            Yes, remove
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="link" onClick={() => setConfirm(artwork.id)} data-testid="artwork-remove">
                          Remove
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="px-5 pb-2 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {storageOn ? (
        <AddArtwork owner={owner} onAdded={() => router.refresh()} />
      ) : (
        <p className="faint border-t border-[var(--hairline-3)] px-5 py-4 text-sm">File storage isn&apos;t switched on for this site yet.</p>
      )}
    </div>
  );
}
