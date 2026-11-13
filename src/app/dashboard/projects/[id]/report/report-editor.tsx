"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconCopy, IconPlus, IconPower, IconSparkles, IconTrash } from "@/components/icons";
import { fetchPicture, picturesForAi } from "@/lib/ai-picture";
import { dialNumber } from "@/lib/dial";
import { draftPhotoReport, reportStart, savePhotoReport, setPhotoReportShared } from "../../report-actions";

type Photo = { id: string; src: string; name: string; takenOn: string; types: string[]; locations: string[] };
type Pair = { beforeId: string; afterId: string; line: string };

function photoLabel(photo: Photo) {
  return [photo.name, photo.takenOn, ...photo.types, ...photo.locations].join(" · ");
}

export function ReportEditor({
  projectId,
  photos: pagePhotos,
  aiOn,
  saved,
  customer,
  jobName,
}: {
  projectId: string;
  photos: Photo[];
  aiOn: boolean;
  saved: { url: string; summary: string; pairs: Pair[]; shared: boolean } | null;
  customer: { name: string; phone: string | null; email: string | null };
  jobName: string;
}) {
  const router = useRouter();
  const [pairs, setPairs] = useState<Pair[]>(saved?.pairs ?? []);
  const [summary, setSummary] = useState(saved?.summary ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  // The page's photos, plus any a draft brought back that arrived after the
  // page was drawn (a crew upload meanwhile), so every pair's photo is one
  // the selects offer (audit fix: the select fell back to the first photo).
  const [later, setLater] = useState<Photo[]>([]);
  const photos = [...pagePhotos, ...later.filter((photo) => !pagePhotos.some((each) => each.id === photo.id))];
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const learn = (found: Photo[]) => setLater((current) => [...current, ...found.filter((photo) => !current.some((each) => each.id === photo.id))]);

  function edit(next: Pair[]) {
    setPairs(next);
    setDirty(true);
  }

  function begin(withAi: boolean) {
    setMessage(null);
    start(async () => {
      const startFrom = await reportStart(projectId);
      if ("error" in startFrom) return void setMessage({ text: startFrom.error, error: true });
      start(() => learn(startFrom.candidates));
      if (!withAi) {
        start(() => {
          setPairs(startFrom.pairs);
          setDirty(true);
          setMessage({ text: `Paired ${startFrom.pairs.length} by Photo Type and date. Write a line for each, then save.` });
        });
        return;
      }
      try {
        setStage(`Getting ${startFrom.candidates.length} photos ready…`);
        const blobs = await Promise.all(startFrom.candidates.map((photo) => fetchPicture(photo.src)));
        const small = await picturesForAi(blobs);
        setStage("Writing the report…");
        const result = await draftPhotoReport(
          projectId,
          startFrom.candidates.map((photo, index) => ({ id: photo.id, base64: small[index] })),
        );
        if ("error" in result) {
          start(() => {
            setStage("");
            setMessage({ text: result.error, error: true });
          });
          return;
        }
        start(() => {
          setStage("");
          setPairs(result.pairs);
          setSummary(result.summary);
          setDirty(true);
          setMessage({
            text: [
              "Drafted below. Check the words and the photos, then save.",
              result.dropped ? `${result.dropped} ${result.dropped === 1 ? "pair named a photo" : "pairs named photos"} it wasn't sent and ${result.dropped === 1 ? "was" : "were"} left out.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          });
        });
      } catch (caught) {
        start(() => {
          setStage("");
          setMessage({ text: caught instanceof Error ? caught.message : "The photos couldn't be read.", error: true });
        });
      }
    });
  }

  function save() {
    setMessage(null);
    start(async () => {
      const result = await savePhotoReport(projectId, { summary, pairs });
      start(() => {
        if (result.error) return setMessage({ text: result.error, error: true });
        setDirty(false);
        setMessage({ text: "Report saved." });
      });
      router.refresh();
    });
  }

  function share(on: boolean) {
    setMessage(null);
    start(async () => {
      const result = await setPhotoReportShared(projectId, on);
      if (result.error) start(() => setMessage({ text: result.error!, error: true }));
      router.refresh();
    });
  }

  const url = saved?.url ?? "";
  const firstName = customer.name.split(/\s+/)[0] || customer.name;
  const words = `Hi ${firstName}, here are the before and after photos from ${jobName}: ${url}`;
  const smsHref = `sms:${customer.phone ? dialNumber(customer.phone).main : ""}?&body=${encodeURIComponent(words)}`;
  const mailHref = `mailto:${customer.email ?? ""}?subject=${encodeURIComponent(`Photos from ${jobName}`)}&body=${encodeURIComponent(`${words}\n`)}`;
  const firstFree = (taken: string[]) => photos.find((photo) => !taken.includes(photo.id))?.id;

  return (
    <div className="space-y-5 p-5" data-testid="report-editor">
      {pairs.length === 0 && !pending && (
        <div className="flex flex-wrap items-center gap-2">
          {aiOn && (
            <button type="button" onClick={() => begin(true)} className="btn btn-primary min-h-11" data-testid="report-draft">
              <IconSparkles size={14} />
              Draft the report from the photos
            </button>
          )}
          <button type="button" onClick={() => begin(false)} className="btn btn-ghost min-h-11" data-testid="report-start">
            {aiOn ? "Pair them myself" : "Pair the photos"}
          </button>
          <p className="faint w-full text-xs">
            {photos.length} {photos.length === 1 ? "photo" : "photos"} on this job. Before and after are picked by Photo Type (Site Walk, Finished Install) where the
            photos carry one, otherwise by date.
          </p>
        </div>
      )}
      {pending && stage && (
        <p className="muted text-sm" role="status" data-testid="report-stage">
          {stage}
        </p>
      )}

      {pairs.length > 0 && (
        <>
          <ul className="space-y-4" data-testid="report-pairs">
            {pairs.map((pair, index) => (
              <li key={index} className="space-y-2 border-b border-[var(--hairline-3)] pb-4" data-testid="report-pair">
                <div className="grid min-w-0 grid-cols-2 gap-3">
                  {(["beforeId", "afterId"] as const).map((side) => {
                    const photo = byId.get(pair[side]);
                    return (
                      <div key={side} className="min-w-0 space-y-1">
                        <p className="eyebrow">{side === "beforeId" ? "Before" : "After"}</p>
                        {photo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo.src} alt={photo.name} className="aspect-[4/3] w-full rounded-lg object-cover" data-testid={`report-${side === "beforeId" ? "before" : "after"}`} data-id={photo.id} />
                        )}
                        <select
                          value={pair[side]}
                          onChange={(event) => edit(pairs.map((each, at) => (at === index ? { ...each, [side]: event.target.value } : each)))}
                          className="input input-sm w-full"
                          aria-label={`${side === "beforeId" ? "Before" : "After"} photo`}
                          data-testid={`report-pick-${side === "beforeId" ? "before" : "after"}`}
                        >
                          {photos.map((option) => (
                            <option key={option.id} value={option.id}>
                              {photoLabel(option)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                <textarea
                  value={pair.line}
                  onChange={(event) => edit(pairs.map((each, at) => (at === index ? { ...each, line: event.target.value } : each)))}
                  maxLength={300}
                  rows={2}
                  placeholder="What changed, in one line"
                  className="input w-full"
                  aria-label={`Line for pair ${index + 1}`}
                  data-testid="report-line"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => edit(pairs.map((each, at) => (at === index ? { ...each, beforeId: each.afterId, afterId: each.beforeId } : each)))}
                    className="btn btn-ghost btn-sm"
                    data-testid="report-swap"
                  >
                    Swap before and after
                  </button>
                  <button type="button" onClick={() => edit(pairs.filter((_, at) => at !== index))} className="btn btn-ghost btn-sm" data-testid="report-remove">
                    <IconTrash size={12} />
                    Remove pair
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              const taken = pairs.flatMap((pair) => [pair.beforeId, pair.afterId]);
              const before = firstFree(taken);
              const after = before ? firstFree([...taken, before]) : undefined;
              // Every photo is in a pair already: say so rather than adding a
              // pair Save would refuse (audit fix).
              if (!before || !after) return setMessage({ text: "Every photo on this job is in a pair already. Add more photos to the job first.", error: true });
              edit([...pairs, { beforeId: before, afterId: after, line: "" }]);
            }}
            disabled={photos.length < 2}
            className="btn btn-ghost btn-sm"
            data-testid="report-add-pair"
          >
            <IconPlus size={13} />
            Add a pair
          </button>
          <div>
            <label className="label" htmlFor="report-summary">
              Summary
            </label>
            <textarea
              id="report-summary"
              value={summary}
              onChange={(event) => {
                setSummary(event.target.value);
                setDirty(true);
              }}
              maxLength={1200}
              rows={3}
              className="input w-full"
              data-testid="report-summary"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={pending} className="btn btn-primary min-h-11" data-testid="report-save">
              {pending && !stage ? "Saving…" : "Save report"}
            </button>
            {dirty && <span className="faint text-xs">Unsaved changes</span>}
          </div>
        </>
      )}

      {message && (
        <p className={`text-sm ${message.error ? "text-[var(--danger)]" : "muted"}`} role={message.error ? "alert" : "status"} data-testid="report-message">
          {message.text}
        </p>
      )}

      {saved && (
        <div className="space-y-3 border-t border-[var(--hairline-3)] pt-4" data-testid="report-share">
          <p className="eyebrow">Customer&apos;s link</p>
          {saved.shared ? (
            <>
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="input input-sm num w-full text-xs"
                aria-label="Customer's link"
                data-testid="report-link"
              />
              <div className="grid gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  className="btn btn-primary min-h-11 w-full"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setCopied(true);
                    } catch {}
                  }}
                  data-testid="report-copy"
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a className="btn btn-ghost min-h-11 w-full" href={smsHref} data-testid="report-text">
                  Text
                </a>
                <a className="btn btn-ghost min-h-11 w-full" href={mailHref} data-testid="report-email">
                  Email
                </a>
                <button type="button" onClick={() => share(false)} disabled={pending} className="btn btn-ghost min-h-11 w-full" data-testid="report-unshare">
                  <IconPower size={13} />
                  Turn off
                </button>
              </div>
              <p className="faint text-xs">
                Text and Email open your own messages and mail with the link written in. Nothing is sent from here.
                {dirty && " Save first: the link shows the report as last saved."}
              </p>
            </>
          ) : (
            <>
              <button type="button" onClick={() => share(true)} disabled={pending} className="btn btn-primary min-h-11" data-testid="report-share-on">
                Share with the customer
              </button>
              <p className="faint text-xs">Makes a link the customer can open without logging in. You can turn it off any time.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
