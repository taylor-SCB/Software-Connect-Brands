"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { IconSparkles } from "@/components/icons";
import { fetchPicture, picturesForAi } from "@/lib/ai-picture";
import { addPunchItems, checkAgainstScope, punchListPhotos } from "@/app/dashboard/projects/photo-ai-actions";
import type { PunchItem } from "@/app/dashboard/projects/photo-ai-actions";

type Found = PunchItem & { title: string; ticked: boolean };

// C2 "Check against the scope" (Release C, Nov 12, 2026): the job's most
// recent photos (or the ones picked on the Files tab) are made small here
// and read against the job's scope lines. What Claude can't see yet comes
// back as a list; ticked items go on the job's things-to-do only when
// "Add to things to do" is pressed.
export function PunchListButton({
  projectId,
  picked,
  label = "Check against the scope",
  className = "btn btn-ghost btn-sm",
  testId = "punch-check",
}: {
  projectId: string;
  picked?: string[];
  label?: string;
  className?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string>();
  const [items, setItems] = useState<Found[] | null>(null);
  const [info, setInfo] = useState("");
  const [photos, setPhotos] = useState<Record<string, { src: string; name: string }>>({});
  const [done, setDone] = useState("");

  function run() {
    setOpen(true);
    setError(undefined);
    setItems(null);
    setDone("");
    start(async () => {
      try {
        setStage("Finding the photos…");
        const found = await punchListPhotos(projectId, picked);
        if ("error" in found) return void setError(found.error);
        if (!found.photos.length) return void setError("There are no photos on this job to check yet.");
        setPhotos(Object.fromEntries(found.photos.map((photo) => [photo.id, { src: photo.src, name: photo.name }])));
        setStage(`Getting ${found.photos.length} ${found.photos.length === 1 ? "photo" : "photos"} ready…`);
        const blobs = await Promise.all(found.photos.map((photo) => fetchPicture(photo.src)));
        const small = await picturesForAi(blobs);
        setStage("Checking them against the scope…");
        const result = await checkAgainstScope(
          projectId,
          found.photos.map((photo, index) => ({ id: photo.id, base64: small[index] })),
        );
        if ("error" in result) return void setError(result.error);
        start(() => {
          setItems(result.items.map((item) => ({ ...item, title: `${item.lineName}: ${item.missing}`, ticked: true })));
          setInfo(
            [
              `Read ${result.looked} ${result.looked === 1 ? "photo" : "photos"}.`,
              result.dropped
                ? `${result.dropped} ${result.dropped === 1 ? "item named a line" : "items named lines"} not on this job and ${result.dropped === 1 ? "was" : "were"} left out.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The photos couldn't be read.");
      }
    });
  }

  function add() {
    const titles = (items ?? []).filter((item) => item.ticked).map((item) => item.title);
    start(async () => {
      const result = await addPunchItems(projectId, titles);
      if (result.error) return void setError(result.error);
      start(() => {
        setDone(`Added ${result.added} to the things to do on the Schedule tab.`);
        setItems((current) => (current ?? []).map((item) => ({ ...item, ticked: false })));
      });
      router.refresh();
    });
  }

  const ticked = (items ?? []).filter((item) => item.ticked).length;

  return (
    <>
      <button type="button" onClick={run} disabled={pending && !open} className={className} data-testid={testId}>
        <IconSparkles size={13} />
        {label}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Punch list"
        title="What the photos don't show yet"
        testId="punch-sheet"
        footer={
          items && items.length > 0 ? (
            <button type="button" onClick={add} disabled={pending || ticked === 0} className="btn btn-primary min-h-11 w-full sm:w-auto" data-testid="punch-add">
              {pending ? "Adding…" : `Add ${ticked} to things to do`}
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <p className="faint text-xs">
            The AI can only judge what the photos show. Something it can&apos;t see may be done, just not photographed.
          </p>
          {pending && !items && (
            <p className="muted text-sm" role="status" data-testid="punch-stage">
              {stage}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]" data-testid="punch-error">
              {error}
            </p>
          )}
          {info && items && (
            <p className="faint text-xs" data-testid="punch-info">
              {info}
            </p>
          )}
          {items && items.length === 0 && (
            <p className="text-sm" data-testid="punch-empty">
              Nothing missing that the photos can show. Every scope line looks done in them.
            </p>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-3" data-testid="punch-items">
              {items.map((item, index) => (
                <li key={`${item.lineId}-${index}`} className="space-y-1.5 border-b border-[var(--hairline-3)] pb-3" data-testid="punch-item" data-line={item.lineId}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1.5 h-4 w-4"
                      checked={item.ticked}
                      onChange={(event) =>
                        setItems((current) => (current ?? []).map((each, at) => (at === index ? { ...each, ticked: event.target.checked } : each)))
                      }
                      data-testid="punch-tick"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="faint block text-xs">
                        {item.scopeName} · {item.lineName}
                      </span>
                      <input
                        value={item.title}
                        maxLength={200}
                        onChange={(event) =>
                          setItems((current) => (current ?? []).map((each, at) => (at === index ? { ...each, title: event.target.value } : each)))
                        }
                        aria-label="To-do wording"
                        className="input input-sm mt-1 w-full"
                        data-testid="punch-title"
                      />
                    </span>
                  </label>
                  {item.photoIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-6" aria-label="Photos it looked at">
                      {item.photoIds.map((id) =>
                        photos[id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={id} src={photos[id].src} alt={photos[id].name} className="h-10 w-10 rounded object-cover" data-testid="punch-photo" />
                        ) : null,
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {done && (
            <p className="text-sm text-[var(--ok)]" role="status" data-testid="punch-done">
              {done}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
