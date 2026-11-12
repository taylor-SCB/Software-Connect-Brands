"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { IconSparkles, IconTrash, IconUpload } from "@/components/icons";
import { pictureForAi } from "@/lib/ai-picture";
import type { DraftedLine } from "@/lib/drafted-lines";
import { addSiteWalkPhoto, draftFromSiteWalk, removeSiteWalkPhoto } from "../site-walk-actions";

export type SiteWalkPhoto = { id: string; src: string; name: string };

const MAX_PICK = 10;

// Each photo made small here (about 1,568 px, JPEG) and kept on the quote.
async function uploadAll(quoteId: string, files: File[], onAdded: (photo: SiteWalkPhoto) => void) {
  let error = "";
  for (const file of files) {
    try {
      const base64 = await pictureForAi(file, 1568, 0.8);
      const result = await addSiteWalkPhoto(quoteId, base64, file.name);
      if (result.error || !result.id) error = result.error ?? "A photo didn't save.";
      else onAdded({ id: result.id, src: `data:image/jpeg;base64,${base64}`, name: file.name });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "A photo couldn't be read.";
    }
  }
  return error;
}

// C4 "Draft from photos" (Release C, Nov 12, 2026), in the line editor's
// bar on a draft quote with AI on. Take or pick up to ten photos, add one
// sentence, and lines come back into the editor unsaved, under the rules
// of Draft lines from the meeting.
export function SiteWalkButton({
  quoteId,
  photos: initial,
  onLines,
}: {
  quoteId: string;
  photos: SiteWalkPhoto[];
  onLines: (lines: DraftedLine[]) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<SiteWalkPhoto[]>([]);
  const photos = [...added.filter((photo) => !initial.some((each) => each.id === photo.id)), ...initial];
  const [picked, setPicked] = useState<string[] | null>(null);
  const ticked = picked ?? photos.slice(0, MAX_PICK).map((photo) => photo.id);
  const [sentence, setSentence] = useState("");
  const [pending, start] = useTransition();
  const [stage, setStage] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  function addFiles(files: File[]) {
    setMessage(null);
    start(async () => {
      setStage("Adding photos…");
      const fresh: SiteWalkPhoto[] = [];
      const error = await uploadAll(quoteId, files, (photo) => fresh.push(photo));
      start(() => {
        setStage("");
        setAdded((current) => [...fresh, ...current]);
        setPicked((current) => {
          const base = current ?? ticked;
          return [...fresh.map((photo) => photo.id), ...base].slice(0, MAX_PICK);
        });
        if (error) setMessage({ text: error, error: true });
      });
      router.refresh();
    });
  }

  function draft() {
    setMessage(null);
    start(async () => {
      setStage("Looking at the photos and your catalog…");
      const result = await draftFromSiteWalk(quoteId, ticked, sentence);
      start(() => {
        setStage("");
        if ("error" in result) return setMessage({ text: result.error, error: true });
        onLines(result.lines);
        const typed = result.lines.filter((line) => line.kind === "typed").length;
        setMessage({
          text: [
            result.lines.length === 0
              ? "Nothing in the photos to add."
              : `Added ${result.lines.length} ${result.lines.length === 1 ? "line" : "lines"} to the quote. Check them, then Save.`,
            typed ? `${typed} ${typed === 1 ? "needs a price" : "need prices"}.` : "",
            result.dropped
              ? `${result.dropped} ${result.dropped === 1 ? "line named a product" : "lines named products"} not in your catalog and ${result.dropped === 1 ? "was" : "were"} left out.`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
        if (result.lines.length) setOpen(false);
      });
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="site-walk-open">
        <IconSparkles size={13} />
        Draft from photos
      </button>
      {message && !open && (
        <span className={`text-xs ${message.error ? "text-[var(--danger)]" : "faint"}`} data-testid="site-walk-info">
          {message.text}
        </span>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Site walk"
        title="Draft lines from photos"
        testId="site-walk-sheet"
        footer={
          <button type="button" onClick={draft} disabled={pending || ticked.length === 0} className="btn btn-primary min-h-11 w-full sm:w-auto" data-testid="site-walk-draft">
            <IconSparkles size={14} />
            {pending && stage.startsWith("Looking") ? "Drafting…" : `Draft lines from ${ticked.length} ${ticked.length === 1 ? "photo" : "photos"}`}
          </button>
        }
      >
        <div className="space-y-4">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="sr-only"
            data-testid="site-walk-files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) addFiles(files);
            }}
          />
          <button type="button" onClick={() => input.current?.click()} disabled={pending} className="btn btn-ghost min-h-11 w-full justify-center" data-testid="site-walk-add">
            <IconUpload size={15} />
            Take or pick photos
          </button>
          {photos.length > 0 && (
            <div>
              <p className="faint mb-2 text-xs">
                Tick up to {MAX_PICK}. Kept on this quote for your team (never on the customer&apos;s copy) and moved into the job&apos;s photos when it&apos;s signed.
              </p>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {photos.map((photo) => {
                  const on = ticked.includes(photo.id);
                  return (
                    <li key={photo.id} className="relative">
                      <label className="block cursor-pointer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.src} alt={photo.name} className={`aspect-square w-full rounded object-cover ${on ? "ring-2 ring-[var(--brand)]" : "opacity-60"}`} />
                        <input
                          type="checkbox"
                          className="absolute left-1 top-1 h-5 w-5"
                          checked={on}
                          disabled={!on && ticked.length >= MAX_PICK}
                          onChange={(event) => setPicked(event.target.checked ? [...ticked, photo.id] : ticked.filter((id) => id !== photo.id))}
                          aria-label={`Use ${photo.name}`}
                          data-testid="site-walk-pick"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div>
            <label className="label" htmlFor="site-walk-sentence">
              One sentence about the job
            </label>
            <input
              id="site-walk-sentence"
              value={sentence}
              onChange={(event) => setSentence(event.target.value)}
              maxLength={500}
              placeholder="Replace the lobby lights with LED, 12 fixtures"
              className="input min-h-11 w-full"
              data-testid="site-walk-sentence"
            />
          </div>
          <p className="faint text-xs">Prices come only from your catalog. Anything else comes in as a line marked Price needed.</p>
          {pending && stage && (
            <p className="muted text-sm" role="status">
              {stage}
            </p>
          )}
          {message && (
            <p className={`text-sm ${message.error ? "text-[var(--danger)]" : "muted"}`} role={message.error ? "alert" : "status"} data-testid="site-walk-message">
              {message.text}
            </p>
          )}
        </div>
      </Sheet>
    </span>
  );
}

// The site-walk photos kept on a quote, for the team: shown on the quote
// page (never the customer's copy), removable until the job is made.
export function SiteWalkPhotos({ quoteId, photos, canRemove }: { quoteId: string; photos: SiteWalkPhoto[]; canRemove: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="p-5" data-testid="site-walk-photos">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {photos.map((photo) => (
          <li key={photo.id} className="space-y-1" data-testid="site-walk-photo" data-id={photo.id}>
            <a href={photo.src} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.src} alt={photo.name} loading="lazy" className="aspect-square w-full rounded object-cover" />
            </a>
            {canRemove && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await removeSiteWalkPhoto(quoteId, photo.id);
                    if (result.error) setError(result.error);
                    router.refresh();
                  })
                }
                className="btn btn-ghost btn-sm min-h-11 w-full justify-center lg:min-h-0"
                aria-label={`Remove ${photo.name}`}
                data-testid="site-walk-remove"
              >
                <IconTrash size={12} />
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
