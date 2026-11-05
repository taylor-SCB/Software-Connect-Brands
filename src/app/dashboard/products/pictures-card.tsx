"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Card, CardHeader, FormError } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import { ACCEPTED_PICTURE_TYPES, PictureProblem, resizePicture } from "@/lib/image-resize";
import { colorPicture, finishPicture, makePictureMain, removePicture, startPicture } from "./picture-actions";

export type CardPicture = { id: string; token: string; colorOptionId: string | null; position: number };

const MAX = 6;

type Sending = { key: number; name: string; state: "waiting" | "sending" | "failed"; error?: string };

async function put(driver: "local" | "vercel-blob", key: string, ticket: string, body: Blob, type: string) {
  if (driver === "local") {
    const response = await fetch(`/api/storage/local?t=${encodeURIComponent(ticket)}`, {
      method: "PUT",
      headers: { "Content-Type": type },
      body,
    });
    if (!response.ok) throw new Error("The picture didn't arrive. Add it again.");
    return;
  }
  await upload(key, body, { access: "private", handleUploadUrl: "/api/storage/upload", clientPayload: ticket, contentType: type });
}

// A product's pictures (Release 3b): up to six, the first is the main one
// (the Products list, quotes and partner ratesheets show it), and each can
// belong to one of the Colors the product comes in. Outside the product
// form: a picture is sent straight to the store, never in the form's post.
export function PicturesCard({
  productId,
  pictures,
  colors,
  storageOn,
}: {
  productId: string;
  pictures: CardPicture[];
  colors: { id: string; name: string }[];
  storageOn: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<Sending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string } | { ok: true }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) setError(result.error);
      router.refresh();
    });
  }

  async function send(list: File[]) {
    setError(undefined);
    setNote(null);
    const room = MAX - pictures.length;
    const take = list.slice(0, Math.max(0, room));
    if (list.length > take.length) {
      setNote(
        room <= 0
          ? `Up to ${MAX} pictures. Remove one first.`
          : `Up to ${MAX} pictures: added the first ${take.length}, left out ${list.length - take.length}.`,
      );
    }
    if (!take.length) return;
    const base = Date.now();
    setSending(take.map((file, index) => ({ key: base + index, name: file.name, state: "waiting" })));
    setBusy(true);
    const update = (key: number, patch: Partial<Sending>) =>
      setSending((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

    // One at a time: a phone holds one full-size photo in memory, not six.
    for (let index = 0; index < take.length; index += 1) {
      const file = take[index];
      const key = base + index;
      update(key, { state: "sending" });
      try {
        const made = await resizePicture(file);
        const started = await startPicture(productId, made.type);
        if ("error" in started) throw new PictureProblem(started.error);
        const blobs = { display: made.display, thumb: made.thumb, doc: made.doc };
        for (const part of started.files) await put(started.driver, part.key, part.ticket, blobs[part.role], part.type);
        const done = await finishPicture({
          productId,
          tickets: started.files.map((part) => part.ticket),
          width: made.width,
          height: made.height,
        });
        if ("error" in done) throw new PictureProblem(done.error);
        setSending((current) => current.filter((row) => row.key !== key));
      } catch (caught) {
        update(key, {
          state: "failed",
          error: caught instanceof PictureProblem ? caught.message : "That picture didn't go. Try again.",
        });
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <Card lit className="mt-5">
      <CardHeader
        title="Pictures"
        subtitle={`Up to ${MAX}. The first is the main one: it shows on the Products list, quotes and partner ratesheets.`}
      />
      <div className="space-y-3 p-5" data-testid="product-pictures">
        {pictures.length > 0 && (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {pictures.map((picture, index) => (
              <li key={picture.id} className="space-y-1.5" data-testid="picture-tile">
                <div className="relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/files/${picture.token}?v=thumb`}
                    alt={`Picture ${index + 1}`}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                  {index === 0 && (
                    <span className="absolute left-1 top-1 rounded bg-[var(--brand)] px-1.5 py-0.5 text-[0.6rem] font-semibold text-white" data-testid="picture-main">
                      Main
                    </span>
                  )}
                </div>
                {colors.length > 0 || picture.colorOptionId ? (
                  <select
                    value={picture.colorOptionId ?? ""}
                    onChange={(event) => run(() => colorPicture(productId, picture.id, event.target.value || null))}
                    aria-label={`Picture ${index + 1} color`}
                    data-testid="picture-color"
                    className="select input-sm !text-[0.7rem]"
                  >
                    <option value="">Any color</option>
                    {colors.map((color) => (
                      <option key={color.id} value={color.id}>
                        {color.name}
                      </option>
                    ))}
                    {picture.colorOptionId && !colors.some((color) => color.id === picture.colorOptionId) && (
                      <option value={picture.colorOptionId}>A color it no longer comes in</option>
                    )}
                  </select>
                ) : null}
                <div className="flex gap-1">
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => run(() => makePictureMain(productId, picture.id))}
                      className="btn btn-ghost btn-sm flex-1 !px-1 !text-[0.7rem]"
                      data-testid="picture-make-main"
                    >
                      Make main
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run(() => removePicture(productId, picture.id))}
                    aria-label={`Remove picture ${index + 1}`}
                    className="btn btn-icon-danger btn-sm"
                    data-testid="picture-remove"
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {sending.length > 0 && (
          <ul className="space-y-1 text-xs" data-testid="picture-sending">
            {sending.map((row) => (
              <li key={row.key} className={row.state === "failed" ? "text-[var(--danger)]" : "faint"}>
                {row.name}: {row.state === "failed" ? row.error : row.state === "sending" ? "adding…" : "waiting"}
              </li>
            ))}
          </ul>
        )}
        {!storageOn ? (
          <p className="faint text-xs">Picture storage isn&apos;t switched on for this site yet.</p>
        ) : pictures.length < MAX ? (
          <label className={`btn btn-ghost btn-sm w-fit ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <IconPlus size={13} />
            {busy ? "Adding…" : "Add picture"}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_PICTURE_TYPES.join(",")}
              multiple
              disabled={busy}
              onChange={(event) => send(Array.from(event.target.files ?? []))}
              className="sr-only"
              data-testid="picture-input"
            />
          </label>
        ) : (
          <p className="faint text-xs">Six pictures, the most a product holds. Remove one to add another.</p>
        )}
        {note && <p className="text-xs text-[var(--warn)]" data-testid="picture-note">{note}</p>}
        <FormError message={error} />
        {colors.length === 0 && pictures.length > 0 && (
          <p className="faint text-[0.7rem]">Tick Colors under Variations and a picture can belong to one.</p>
        )}
      </div>
    </Card>
  );
}
