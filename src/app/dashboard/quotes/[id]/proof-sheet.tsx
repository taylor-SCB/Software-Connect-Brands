"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { IconPlus, IconTrash } from "@/components/icons";
import { AddArtwork, ArtworkTile, ArtworkWarning } from "@/components/artwork-card";
import {
  copyEarlierProofAction,
  earlierProofsAction,
  finishProofUpload,
  setLineProofAction,
  startProofUpload,
} from "@/app/dashboard/proofs/actions";
import { putStoredFile } from "@/lib/blob-put";
import { drawProof, garmentPath, loadImage, proofCopies } from "@/lib/proof-draw";
import {
  MAX_PANELS,
  PROOF_STATUS_TEXT,
  cleanPlacement,
  defaultPlacement,
  defaultPlainSide,
  guessGarmentColor,
  type BaseKind,
  type Placement,
} from "@/lib/proof-shared";
import type { ProofPageData } from "./proofs";

// The apparel pack (Nov 12, 2026): making or changing a proof. One panel per
// print location; each puts a piece of the customer's artwork, exactly as
// uploaded, on one of the product's pictures or on a plain garment in the
// colour, where it is dragged and sized by hand. Saving draws the panels
// into one picture in the browser and keeps it as a draft until Send proofs.

type Opened = { kind: "line"; lineId: string } | { kind: "proof"; proofId: string };

type PanelState = {
  key: string;
  locationOptionId: string;
  artworkId: string | null;
  baseKind: BaseKind;
  baseImageId: string | null;
  baseColor: string;
  placement: Placement;
};

let panelCounter = 0;
const nextKey = () => `panel-${(panelCounter += 1)}`;

// The artwork's own shape inside a placement: the box keeps it, centred on
// where the location would put it.
function fitPlacement(base: Placement, aspect: number): Placement {
  let w = base.w;
  let h = w * aspect;
  const maxH = Math.max(base.h * 1.4, 0.12);
  if (h > maxH) {
    h = maxH;
    w = h / aspect;
  }
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  return cleanPlacement({ x: cx - w / 2, y: cy - h / 2, w, h }) ?? base;
}

function PanelPreview({
  panel,
  baseToken,
  artworkSrc,
  aspect,
  onPlace,
}: {
  panel: PanelState;
  baseToken: string | null;
  artworkSrc: string | null;
  aspect: number;
  onPlace: (placement: Placement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; start: Placement } | null>(null);
  const { x, y, w, h } = panel.placement;

  function down(event: React.PointerEvent, mode: "move" | "size") {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { mode, x: event.clientX, y: event.clientY, start: panel.placement };
  }
  function move(event: React.PointerEvent) {
    const state = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const dx = (event.clientX - state.x) / rect.width;
    const dy = (event.clientY - state.y) / rect.height;
    if (state.mode === "move") {
      onPlace(cleanPlacement({ ...state.start, x: state.start.x + dx, y: state.start.y + dy }) ?? state.start);
    } else {
      const width = Math.max(0.04, state.start.w + dx);
      onPlace(cleanPlacement({ ...state.start, w: width, h: width * aspect }) ?? state.start);
    }
  }
  function up() {
    drag.current = null;
  }
  function key(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const p = panel.placement;
    const moves: Record<string, Placement> = {
      ArrowLeft: { ...p, x: p.x - step },
      ArrowRight: { ...p, x: p.x + step },
      ArrowUp: { ...p, y: p.y - step },
      ArrowDown: { ...p, y: p.y + step },
      "+": { ...p, w: p.w + step, h: (p.w + step) * aspect },
      "=": { ...p, w: p.w + step, h: (p.w + step) * aspect },
      "-": { ...p, w: Math.max(0.04, p.w - step), h: Math.max(0.04, p.w - step) * aspect },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    onPlace(cleanPlacement(next) ?? p);
  }

  return (
    <div
      ref={box}
      className="relative aspect-square w-full max-w-[420px] touch-none select-none overflow-hidden rounded-lg border border-[var(--hairline-2)] bg-white"
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      data-testid="proof-canvas"
    >
      {panel.baseKind === "picture" && baseToken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/files/${baseToken}`} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false} />
      ) : (
        <svg viewBox="0 0 1000 1000" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <path
            d={garmentPath(panel.baseKind === "plain-back" ? "back" : "front")}
            fill={panel.baseColor}
            stroke="rgba(0,0,0,0.28)"
            strokeWidth={4}
          />
        </svg>
      )}
      {artworkSrc && (
        <div
          role="slider"
          tabIndex={0}
          aria-label="Artwork position. Arrow keys move it, plus and minus size it."
          aria-valuetext={`${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down, ${Math.round(w * 100)}% wide`}
          className="absolute cursor-move outline outline-1 outline-dashed outline-[rgba(37,99,235,0.8)] focus-visible:outline-2"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          onPointerDown={(event) => down(event, "move")}
          onKeyDown={key}
          data-testid="proof-artwork-box"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artworkSrc} alt="" className="pointer-events-none h-full w-full object-contain" draggable={false} />
          <span
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-[rgb(37,99,235)] shadow"
            onPointerDown={(event) => down(event, "size")}
            data-testid="proof-artwork-size"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

export function ProofSheet({ data, opened, onClose }: { data: ProofPageData; opened: Opened; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proof = opened.kind === "proof" ? data.proofs.find((item) => item.id === opened.proofId) ?? null : null;
  const openingLine = opened.kind === "line" ? data.lines.find((line) => line.id === opened.lineId) ?? null : null;
  const productId = proof?.productId ?? openingLine?.productId ?? null;
  const colorOptionId = proof ? proof.colorOptionId : (openingLine?.colorOptionId ?? null);
  const product = productId ? data.products[productId] : undefined;
  const colorLabel = colorOptionId ? (data.colors[colorOptionId] ?? proof?.colorLabel ?? null) : null;
  const newest = proof?.versions[0] ?? null;

  const sameKey = data.lines.filter((line) => line.productId === productId && line.colorOptionId === colorOptionId);
  const otherProofs = data.proofs.filter(
    (item) => item.id !== proof?.id && item.productId === productId && item.colorOptionId === colorOptionId,
  );

  const [stage, setStage] = useState<"choose" | "edit">(opened.kind === "proof" || otherProofs.length === 0 ? "edit" : "choose");
  const [earlier, setEarlier] = useState<Awaited<ReturnType<typeof earlierProofsAction>> | null>(null);
  const [addingArtwork, setAddingArtwork] = useState(false);

  // Pictures of this product, those of the line's Color first; and any a
  // panel already uses that the product has since lost.
  const pictures = useMemo(() => {
    const list = [...(product?.pictures ?? [])].sort(
      (a, b) => Number(b.colorOptionId === colorOptionId && colorOptionId !== null) - Number(a.colorOptionId === colorOptionId && colorOptionId !== null),
    );
    for (const panel of newest?.panels ?? []) {
      if (panel.baseImageId && panel.baseImageToken && !list.some((picture) => picture.id === panel.baseImageId)) {
        list.push({ id: panel.baseImageId, token: panel.baseImageToken, colorOptionId: null });
      }
    }
    return list;
  }, [product, colorOptionId, newest]);
  const colorPicture = pictures.find((picture) => colorOptionId && picture.colorOptionId === colorOptionId) ?? null;

  // The customer's artwork, and any a panel already uses that was removed.
  const artworks = useMemo(() => {
    const list = data.artworks.map((artwork) => ({ ...artwork, label: artwork.name }));
    for (const panel of newest?.panels ?? []) {
      if (panel.artworkId && !list.some((artwork) => artwork.id === panel.artworkId)) {
        list.push({
          id: panel.artworkId,
          name: panel.artworkName,
          label: `${panel.artworkName} (removed)`,
          inkNote: panel.inkNote,
          width: null,
          height: null,
          printName: null,
          printFormat: null,
          printSize: null,
          checkStatus: null,
          checkNote: null,
          removed: true,
        });
      }
    }
    return list;
  }, [data.artworks, newest]);

  const [aspects, setAspects] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.artworks.filter((a) => a.width && a.height).map((a) => [a.id, a.height! / a.width!])),
  );
  const aspectOf = (artworkId: string | null) => (artworkId ? (aspects[artworkId] ?? 1) : 1);

  const locationName = (locationId: string) => data.locations.find((location) => location.id === locationId)?.name ?? "";
  const liveLocations = data.locations.filter((location) => !location.archived);

  function freshPanel(used: string[]): PanelState {
    const location =
      liveLocations.find((option) => !used.includes(option.id) && /^front$/i.test(option.name)) ??
      liveLocations.find((option) => !used.includes(option.id)) ??
      liveLocations[0];
    const artworkId = artworks.find((artwork) => !artwork.removed)?.id ?? null;
    const name = location?.name ?? "";
    const back = /back/i.test(name);
    return {
      key: nextKey(),
      locationOptionId: location?.id ?? "",
      artworkId,
      baseKind: colorPicture && !back ? "picture" : defaultPlainSide(name),
      baseImageId: colorPicture && !back ? colorPicture.id : null,
      baseColor: guessGarmentColor(colorLabel),
      placement: fitPlacement(defaultPlacement(name), aspectOf(artworkId)),
    };
  }

  const [panels, setPanels] = useState<PanelState[]>(() =>
    newest
      ? newest.panels.map((panel) => ({
          key: nextKey(),
          locationOptionId: panel.locationOptionId ?? liveLocations[0]?.id ?? "",
          artworkId: panel.artworkId,
          baseKind: panel.baseKind,
          baseImageId: panel.baseImageId,
          baseColor: panel.baseColor ?? guessGarmentColor(colorLabel),
          placement: panel.placement,
        }))
      : [freshPanel([])],
  );
  const [active, setActive] = useState(0);
  const [changed, setChanged] = useState(!newest);
  const [lineIds, setLineIds] = useState<Set<string>>(() =>
    proof
      ? new Set(proof.lineIds)
      : new Set([...(openingLine ? [openingLine.id] : []), ...sameKey.filter((line) => !line.proofId).map((line) => line.id)]),
  );

  const panel = panels[Math.min(active, panels.length - 1)];
  const nextVersion = newest ? (newest.status === "DRAFT" ? newest.version : newest.version + 1) : 1;
  const number = proof?.number ?? Math.max(0, ...data.proofs.map((item) => item.number)) + 1;

  function update(index: number, patch: Partial<PanelState>) {
    setChanged(true);
    setPanels((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function pickLocation(index: number, locationId: string) {
    const name = locationName(locationId);
    const current = panels[index];
    const patch: Partial<PanelState> = {
      locationOptionId: locationId,
      placement: fitPlacement(defaultPlacement(name), aspectOf(current.artworkId)),
    };
    if (current.baseKind !== "picture") patch.baseKind = defaultPlainSide(name);
    update(index, patch);
  }

  function pickArtwork(index: number, artworkId: string) {
    const current = panels[index];
    update(index, {
      artworkId,
      placement: fitPlacement(current.placement, aspectOf(artworkId)),
    });
  }

  function addPanel() {
    if (panels.length >= MAX_PANELS) return;
    const made = freshPanel(panels.map((item) => item.locationOptionId));
    setChanged(true);
    setPanels([...panels, made]);
    setActive(panels.length);
  }

  function removePanel(index: number) {
    if (panels.length <= 1) return;
    setChanged(true);
    setPanels(panels.filter((_, i) => i !== index));
    setActive(0);
  }

  // A line already on this proof is moved on or off at once: what the
  // customer approved didn't change, so no new version is made.
  function toggleLine(lineId: string, on: boolean) {
    setError(null);
    if (!proof) {
      setLineIds((current) => {
        const next = new Set(current);
        if (on) next.add(lineId);
        else next.delete(lineId);
        return next;
      });
      return;
    }
    if (!on && lineIds.size <= 1 && lineIds.has(lineId) && !changed) {
      setError("A proof needs at least one line. Delete the proof instead.");
      return;
    }
    start(async () => {
      const result = await setLineProofAction(lineId, on ? proof.id : null);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      setLineIds((current) => {
        const next = new Set(current);
        if (on) next.add(lineId);
        else next.delete(lineId);
        return next;
      });
      router.refresh();
    });
  }

  async function save() {
    setError(null);
    if (!productId) return;
    if (!lineIds.size) {
      setError("Tick at least one line this proof is for.");
      return;
    }
    if (panels.some((item) => !item.artworkId)) {
      setError("Pick the artwork for every print location.");
      return;
    }
    if (panels.some((item) => item.baseKind === "picture" && !item.baseImageId)) {
      setError("Pick what to draw it on.");
      return;
    }
    try {
      setBusy("Drawing the proof…");
      const drawPanels = await Promise.all(
        panels.map(async (item) => {
          const picture = item.baseKind === "picture" ? pictures.find((p) => p.id === item.baseImageId) : undefined;
          const artwork = artworks.find((a) => a.id === item.artworkId);
          const shownOn =
            picture && colorOptionId && picture.colorOptionId !== colorOptionId
              ? `Shown on ${picture.colorOptionId ? (data.colors[picture.colorOptionId] ?? "another colour") : "another colour"}; printed on ${colorLabel}`
              : null;
          return {
            baseKind: item.baseKind,
            baseImage: picture ? await loadImage(`/files/${picture.token}`) : null,
            baseColor: item.baseColor,
            artwork: await loadImage(`/dashboard/artwork/${item.artworkId}/picture`),
            placement: item.placement,
            caption: [locationName(item.locationOptionId), artwork?.name, artwork?.inkNote].filter(Boolean).join(" · "),
            note: shownOn,
          };
        }),
      );
      const title = `Proof ${number} · v${nextVersion} · ${product?.name ?? "Product"}${colorLabel ? ` · ${colorLabel}` : ""} · QUO-${data.quoteNumber}`;
      const copies = await proofCopies(drawProof(title, drawPanels));
      setBusy("Saving…");
      const started = await startProofUpload(data.quoteId, copies.type);
      if ("error" in started) throw new Error(started.error);
      const bodies: Record<string, Blob> = { display: copies.display, thumb: copies.thumb, doc: copies.doc };
      for (const file of started.files) await putStoredFile(started.driver, file.key, file.ticket, bodies[file.role], file.type);
      const result = await finishProofUpload({
        quoteId: data.quoteId,
        proofId: proof?.id ?? null,
        baseVersionId: newest?.id ?? null,
        productId,
        colorOptionId,
        lineIds: [...lineIds],
        panels: panels.map((item) => ({
          locationOptionId: item.locationOptionId,
          artworkId: item.artworkId!,
          baseKind: item.baseKind,
          baseImageId: item.baseKind === "picture" ? item.baseImageId : null,
          baseColor: item.baseKind === "picture" ? null : item.baseColor,
          placement: item.placement,
        })),
        tickets: started.files.map((file) => file.ticket),
        width: copies.width,
        height: copies.height,
      });
      if ("error" in result) throw new Error(result.error);
      setBusy(null);
      onClose();
      router.refresh();
    } catch (problem) {
      setBusy(null);
      setError(problem instanceof Error ? problem.message : "The proof couldn't be saved. Try again.");
    }
  }

  const title = proof
    ? `Proof ${proof.number} · ${proof.productName}${colorLabel ? ` · ${colorLabel}` : ""}`
    : `New proof · ${product?.name ?? "Product"}${colorLabel ? ` · ${colorLabel}` : ""}`;

  if (!productId || (!proof && !openingLine)) {
    return (
      <Sheet open onClose={onClose} title="Proof" testId="proof-sheet">
        <p className="text-sm">This line changed. Save the quote and try again.</p>
      </Sheet>
    );
  }

  if (stage === "choose" && openingLine) {
    return (
      <Sheet open onClose={onClose} eyebrow="Proof" title={title} testId="proof-sheet" wide>
        <div className="space-y-4">
          <p className="muted text-sm">This garment already has a proof on this quote. Use it for {openingLine.label}, or make another design.</p>
          <ul className="space-y-2">
            {otherProofs.map((item) => {
              const version = item.versions[0];
              return (
                <li key={item.id} className="flex items-center gap-3">
                  {version && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/files/${version.token}?v=thumb`} alt="" className="h-14 w-20 rounded border border-[var(--hairline-2)] bg-white object-contain" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">Proof {item.number}</p>
                    {version && <p className="faint text-xs">{PROOF_STATUS_TEXT[version.status]}</p>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await setLineProofAction(openingLine.id, item.id);
                        if ("error" in result && result.error) {
                          setError(result.error);
                          return;
                        }
                        onClose();
                        router.refresh();
                      })
                    }
                    data-testid="proof-use-existing"
                  >
                    Use Proof {item.number}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStage("edit")} data-testid="proof-make-new">
            <IconPlus size={12} />
            Make a new design
          </button>
          {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
        </div>
      </Sheet>
    );
  }

  const artworkSrc = panel?.artworkId ? `/dashboard/artwork/${panel.artworkId}/picture` : null;
  const baseToken = panel?.baseKind === "picture" ? (pictures.find((p) => p.id === panel.baseImageId)?.token ?? null) : null;
  const chosenPicture = panel?.baseKind === "picture" ? pictures.find((p) => p.id === panel.baseImageId) : undefined;
  const wrongColor = Boolean(chosenPicture && colorOptionId && chosenPicture.colorOptionId !== colorOptionId);
  const canSave = changed && !busy && !pending && data.storageOn && artworks.length > 0;

  return (
    <Sheet
      open
      onClose={onClose}
      eyebrow={newest ? (newest.status === "DRAFT" ? `Draft · v${newest.version}` : `Making v${nextVersion}`) : "New proof"}
      title={title}
      testId="proof-sheet"
      wide
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {busy && <span className="faint text-xs" role="status">{busy}</span>}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={Boolean(busy)}>
            {changed ? "Cancel" : "Close"}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave} data-testid="proof-save">
            {newest && newest.status !== "DRAFT" ? `Save as v${nextVersion}` : "Save draft"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {newest && newest.status !== "DRAFT" && (
          <p className="rounded-lg border border-[var(--hairline-2)] px-3 py-2 text-xs" data-testid="proof-new-version-note">
            Changing the picture makes version {nextVersion}. They keep seeing version {newest.version} ({PROOF_STATUS_TEXT[newest.status].toLowerCase()}) until you send the new one.
          </p>
        )}
        {!data.storageOn && <p className="text-sm text-[var(--danger)]">File storage isn&apos;t switched on for this site yet.</p>}

        <section>
          <h3 className="label mb-2">Print locations</h3>
          <div className="flex flex-wrap gap-2" role="tablist">
            {panels.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={index === active}
                className={`btn btn-sm ${index === active ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setActive(index)}
                data-testid="proof-panel-tab"
              >
                {locationName(item.locationOptionId) || "Location"}
              </button>
            ))}
            {panels.length < MAX_PANELS && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={addPanel} data-testid="proof-add-panel">
                <IconPlus size={12} />
                Add a location
              </button>
            )}
          </div>
        </section>

        {panel && (
          <div className="grid gap-5 sm:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2">
              <PanelPreview
                panel={panel}
                baseToken={baseToken}
                artworkSrc={artworkSrc}
                aspect={aspectOf(panel.artworkId)}
                onPlace={(placement) => update(active, { placement })}
              />
              <p className="faint text-xs">Drag the logo to move it; drag the blue corner to size it. Arrow keys work too.</p>
              {wrongColor && (
                <p className="text-xs text-[var(--warn)]" data-testid="proof-wrong-color">
                  This picture isn&apos;t {colorLabel}. The proof will say &ldquo;Shown on {chosenPicture?.colorOptionId ? data.colors[chosenPicture.colorOptionId] : "another colour"}; printed on {colorLabel}&rdquo;.
                </p>
              )}
            </div>

            <div className="min-w-0 space-y-4">
              <label className="block text-sm">
                <span className="label">Location</span>
                <select
                  className="select mt-1"
                  value={panel.locationOptionId}
                  onChange={(event) => pickLocation(active, event.target.value)}
                  data-testid="proof-location"
                >
                  {data.locations
                    .filter((location) => !location.archived || location.id === panel.locationOptionId)
                    .map((location) => (
                      <option
                        key={location.id}
                        value={location.id}
                        disabled={panels.some((item, i) => i !== active && item.locationOptionId === location.id)}
                      >
                        {location.name}
                        {location.archived ? " (retired)" : ""}
                      </option>
                    ))}
                </select>
              </label>

              <div>
                <p className="label mb-1">Artwork</p>
                {artworks.length === 0 && !addingArtwork && <p className="faint mb-2 text-sm">No artwork for this customer yet.</p>}
                <div className="flex flex-wrap gap-2">
                  {artworks.map((artwork) => (
                    <button
                      key={artwork.id}
                      type="button"
                      onClick={() => pickArtwork(active, artwork.id)}
                      className={`rounded-lg p-0.5 ${panel.artworkId === artwork.id ? "ring-2 ring-[var(--brand)]" : ""}`}
                      title={artwork.label}
                      aria-pressed={panel.artworkId === artwork.id}
                      data-testid="proof-artwork"
                      data-name={artwork.name}
                    >
                      <ArtworkTile artwork={artwork} size={56} />
                    </button>
                  ))}
                </div>
                {(() => {
                  const picked = artworks.find((artwork) => artwork.id === panel.artworkId);
                  return picked ? (
                    <div className="mt-1 text-xs">
                      <p className="muted">{picked.label}{picked.inkNote ? ` · ${picked.inkNote}` : ""}</p>
                      <ArtworkWarning artwork={picked} />
                    </div>
                  ) : null;
                })()}
                {addingArtwork ? (
                  <div className="mt-2 rounded-lg border border-[var(--hairline-2)] p-3">
                    <AddArtwork
                      owner={data.artworkOwner}
                      compact
                      onAdded={(id) => {
                        setAddingArtwork(false);
                        router.refresh();
                        update(active, { artworkId: id });
                      }}
                    />
                  </div>
                ) : (
                  data.storageOn && (
                    <button type="button" className="link mt-2 text-xs" onClick={() => setAddingArtwork(true)} data-testid="proof-add-artwork">
                      + Add artwork
                    </button>
                  )
                )}
              </div>

              <div>
                <p className="label mb-1">Draw it on</p>
                <div className="flex flex-wrap gap-2">
                  {pictures.map((picture) => {
                    const pictureColor = picture.colorOptionId ? data.colors[picture.colorOptionId] : null;
                    const picked = panel.baseKind === "picture" && panel.baseImageId === picture.id;
                    return (
                      <button
                        key={picture.id}
                        type="button"
                        onClick={() => update(active, { baseKind: "picture", baseImageId: picture.id })}
                        className={`flex flex-col items-center gap-0.5 rounded-lg p-1 text-[0.65rem] ${picked ? "ring-2 ring-[var(--brand)]" : ""}`}
                        aria-pressed={picked}
                        data-testid="proof-base-picture"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/files/${picture.token}?v=thumb`} alt="" className="h-12 w-12 rounded bg-white object-contain" />
                        <span className={colorOptionId && picture.colorOptionId !== colorOptionId ? "text-[var(--warn)]" : "muted"}>
                          {pictureColor ?? "Picture"}
                        </span>
                      </button>
                    );
                  })}
                  {(["plain-front", "plain-back"] as const).map((kind) => {
                    const picked = panel.baseKind === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => update(active, { baseKind: kind, baseImageId: null })}
                        className={`flex flex-col items-center gap-0.5 rounded-lg p-1 text-[0.65rem] ${picked ? "ring-2 ring-[var(--brand)]" : ""}`}
                        aria-pressed={picked}
                        data-testid={`proof-base-${kind}`}
                      >
                        <svg viewBox="0 0 1000 1000" className="h-12 w-12 rounded bg-white" aria-hidden="true">
                          <path d={garmentPath(kind === "plain-back" ? "back" : "front")} fill={panel.baseColor} stroke="rgba(0,0,0,0.28)" strokeWidth={8} />
                        </svg>
                        <span className="muted">{kind === "plain-back" ? "Plain back" : "Plain front"}</span>
                      </button>
                    );
                  })}
                </div>
                {!colorPicture && colorLabel && (
                  <p className="faint mt-1 text-xs" data-testid="proof-no-color-picture">
                    No {colorLabel} picture of this product, so it&apos;s drawn on a plain garment in the colour below.
                  </p>
                )}
                {panel.baseKind !== "picture" && (
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="color"
                      value={panel.baseColor}
                      onChange={(event) => update(active, { baseColor: event.target.value })}
                      className="h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
                      data-testid="proof-base-color"
                    />
                    <span className="muted">Garment colour{colorLabel ? ` (${colorLabel})` : ""}</span>
                  </label>
                )}
              </div>

              {panels.length > 1 && (
                <button type="button" className="link inline-flex items-center gap-1 text-xs text-[var(--danger)]" onClick={() => removePanel(active)} data-testid="proof-remove-panel">
                  <IconTrash size={11} />
                  Take {locationName(panel.locationOptionId) || "this location"} off
                </button>
              )}
            </div>
          </div>
        )}

        <section>
          <h3 className="label mb-2">Lines it&apos;s for</h3>
          <ul className="space-y-1.5" data-testid="proof-lines">
            {sameKey.map((line) => {
              const elsewhere = line.proofId && line.proofId !== proof?.id ? data.proofs.find((item) => item.id === line.proofId) : null;
              return (
                <li key={line.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={lineIds.has(line.id)}
                      disabled={pending || Boolean(busy)}
                      onChange={(event) => toggleLine(line.id, event.target.checked)}
                      data-testid="proof-line"
                    />
                    <span>{line.label}</span>
                    {elsewhere && !lineIds.has(line.id) && (
                      <span className="faint text-xs">
                        On Proof {elsewhere.number}
                        {elsewhere.versions[0] ? ` · ${PROOF_STATUS_TEXT[elsewhere.versions[0].status].toLowerCase()}` : ""}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        {!proof && openingLine && (
          <section className="border-t border-[var(--hairline-3)] pt-4">
            {earlier === null ? (
              <button
                type="button"
                className="link text-xs"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setEarlier(await earlierProofsAction(data.quoteId, productId, colorOptionId));
                  })
                }
                data-testid="proof-earlier"
              >
                Use an approved proof from an earlier order
              </button>
            ) : earlier.length === 0 ? (
              <p className="faint text-xs" data-testid="proof-earlier-none">No approved proof of this garment and colour on their earlier orders.</p>
            ) : (
              <div className="space-y-2">
                <p className="label">From an earlier order</p>
                {earlier.map((row) => (
                  <div key={row.id} className="flex items-center gap-3" data-testid="proof-earlier-row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/files/${row.token}?v=thumb`} alt="" className="h-14 w-20 rounded border border-[var(--hairline-2)] bg-white object-contain" />
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-medium">{row.label}</p>
                      <p className="faint">{row.approved}</p>
                      <p className="faint truncate">{row.panels.join(" · ")}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pending || !lineIds.size}
                      onClick={() =>
                        start(async () => {
                          const result = await copyEarlierProofAction(data.quoteId, row.id, [...lineIds]);
                          if ("error" in result && result.error) {
                            setError(result.error);
                            return;
                          }
                          onClose();
                          router.refresh();
                        })
                      }
                      data-testid="proof-earlier-use"
                    >
                      Use this
                    </button>
                  </div>
                ))}
                <p className="faint text-xs">It comes in as a draft: this order still gets its own yes, or mark it approved by hand.</p>
              </div>
            )}
          </section>
        )}

        {error && (
          <p className="text-sm text-[var(--danger)]" role="alert" data-testid="proof-error">
            {error}
          </p>
        )}
      </div>
      {/* Measures each artwork's own shape once it loads, for the box. */}
      <div className="hidden">
        {artworks
          .filter((artwork) => !aspects[artwork.id])
          .map((artwork) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={artwork.id}
              src={`/dashboard/artwork/${artwork.id}/picture?v=thumb`}
              alt=""
              onLoad={(event) => {
                const img = event.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setAspects((current) => ({ ...current, [artwork.id]: img.naturalHeight / img.naturalWidth }));
                }
              }}
            />
          ))}
      </div>
      <div className="sr-only" aria-live="polite">{busy ?? ""}</div>
    </Sheet>
  );
}
