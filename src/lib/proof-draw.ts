// The apparel pack (Nov 12, 2026): a proof drawn in the browser. Each panel
// is the base (one of the product's pictures, fitted, or a plain garment in
// a colour) with the artwork placed on it exactly as uploaded, in the box
// the person put it in, and the print location written under it. The panels
// sit side by side (four as two rows) under a header naming the proof, and
// the one picture is made into the same three copies a product picture has.

import { PANEL_PX, PROOF_MAX_BYTES, panelGrid, type BaseKind, type Placement } from "@/lib/proof-shared";
import { resizePicture, type ResizedPicture } from "@/lib/image-resize";

const HEADER_PX = 76;
const CAPTION_PX = 70;

// A plain t-shirt in a 1000-unit square, front and back (the back's neck
// sits higher). Drawn as a path so it scales cleanly.
export function garmentPath(side: "front" | "back") {
  const neck = side === "front" ? 205 : 150;
  return `M 385 115 Q 500 ${neck} 615 115 L 765 150 L 905 310 L 805 430 L 735 385 L 735 915 L 265 915 L 265 385 L 195 430 L 95 310 L 235 150 Z`;
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

export type DrawPanel = {
  baseKind: BaseKind;
  baseImage: HTMLImageElement | null;
  baseColor: string | null;
  artwork: HTMLImageElement;
  placement: Placement;
  caption: string;
  note: string | null;
};

function fitContain(width: number, height: number, box: number) {
  const scale = Math.min(box / width, box / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (box - w) / 2, y: (box - h) / 2, w, h };
}

function drawPanel(context: CanvasRenderingContext2D, panel: DrawPanel) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PANEL_PX, PANEL_PX);
  if (panel.baseKind === "picture" && panel.baseImage) {
    const box = fitContain(panel.baseImage.naturalWidth, panel.baseImage.naturalHeight, PANEL_PX);
    context.drawImage(panel.baseImage, box.x, box.y, box.w, box.h);
  } else {
    const path = new Path2D(garmentPath(panel.baseKind === "plain-back" ? "back" : "front"));
    context.fillStyle = panel.baseColor ?? "#d9d9d6";
    context.fill(path);
    context.strokeStyle = "rgba(0,0,0,0.28)";
    context.lineWidth = 4;
    context.stroke(path);
  }
  // The artwork fills its box keeping its own shape, centred in it.
  const { x, y, w, h } = panel.placement;
  const box = { x: x * PANEL_PX, y: y * PANEL_PX, w: w * PANEL_PX, h: h * PANEL_PX };
  const fit = fitContain(panel.artwork.naturalWidth, panel.artwork.naturalHeight, 1);
  const scale = Math.min(box.w / (fit.w || 1), box.h / (fit.h || 1));
  const aw = fit.w * scale;
  const ah = fit.h * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(panel.artwork, box.x + (box.w - aw) / 2, box.y + (box.h - ah) / 2, aw, ah);
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// The whole proof as one canvas.
export function drawProof(title: string, panels: DrawPanel[]): HTMLCanvasElement {
  const { cols, rows } = panelGrid(panels.length);
  const cellH = PANEL_PX + CAPTION_PX;
  const canvas = document.createElement("canvas");
  canvas.width = cols * PANEL_PX;
  canvas.height = HEADER_PX + rows * cellH;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't draw the proof.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111827";
  context.font = "600 34px system-ui, -apple-system, Segoe UI, sans-serif";
  context.textBaseline = "middle";
  context.fillText(fitText(context, title, canvas.width - 60), 30, HEADER_PX / 2);
  panels.forEach((panel, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    context.save();
    context.translate(col * PANEL_PX, HEADER_PX + row * cellH);
    context.beginPath();
    context.rect(0, 0, PANEL_PX, PANEL_PX);
    context.clip();
    drawPanel(context, panel);
    context.restore();
    const top = HEADER_PX + row * cellH + PANEL_PX;
    context.fillStyle = "#f3f4f6";
    context.fillRect(col * PANEL_PX, top, PANEL_PX, CAPTION_PX);
    context.fillStyle = "#111827";
    context.font = "600 28px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText(fitText(context, panel.caption, PANEL_PX - 40), col * PANEL_PX + 20, top + (panel.note ? 24 : CAPTION_PX / 2));
    if (panel.note) {
      context.fillStyle = "#b45309";
      context.font = "500 22px system-ui, -apple-system, Segoe UI, sans-serif";
      context.fillText(fitText(context, panel.note, PANEL_PX - 40), col * PANEL_PX + 20, top + 52);
    }
    if (col > 0) {
      context.fillStyle = "#e5e7eb";
      context.fillRect(col * PANEL_PX, HEADER_PX + row * cellH, 2, cellH);
    }
  });
  return canvas;
}

// The proof's three copies: display and thumb made the way a product
// picture's are, and a document copy of its own — a JPEG up to 800 px, big
// enough to read on a contract or purchase order and small enough that a
// PDF carrying several stays under its 4 MB (audit, Nov 12: the display
// WebP was re-encoded losslessly by the PDF printer).
export async function proofCopies(canvas: HTMLCanvasElement): Promise<ResizedPicture> {
  let doc: Blob | null = null;
  for (const side of [800, 640, 520]) {
    const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    const context = small.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, small.width, small.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, small.width, small.height);
    const blob = await new Promise<Blob | null>((resolve) => small.toBlob(resolve, "image/jpeg", 0.82));
    small.width = 0;
    small.height = 0;
    if (blob && blob.type === "image/jpeg" && blob.size <= PROOF_MAX_BYTES.doc) {
      doc = blob;
      break;
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || !doc) throw new Error("This browser couldn't make the proof's picture.");
  const copies = await resizePicture(new File([blob], "proof.jpg", { type: "image/jpeg" }));
  return { ...copies, doc };
}
