// The apparel pack (Nov 12, 2026): artwork read in the browser before it is
// sent. What a school or a designer sends — a PNG, a JPEG, an SVG, a PDF or
// an Illustrator file, sometimes an EPS — is kept exactly as sent for the
// printer. From it the browser makes three pictures:
//   preview  up to 2000 px, its transparency kept (WebP, or PNG where the
//            browser can't make WebP), drawn onto proofs
//   thumb    up to 400 px, same type, for the artwork tiles
//   check    up to 512 px, JPEG on mid-grey, for the look-alike check: a
//            white logo on white would be a blank square
// A file nothing in a browser can draw (EPS, PSD, TIFF, CorelDRAW, an
// Illustrator file saved without PDF content) is still kept as the print
// file, and a PNG or JPEG of it is asked for as the picture.

export const ARTWORK_ORIGINAL_MAX = 50 * 1024 * 1024;
const RASTER = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const CAPS = { preview: 2 * 1024 * 1024, thumb: 300 * 1024, check: 160 * 1024 };
const PREVIEW_SIDES = [2000, 1600, 1200, 900];
const MID_GREY = "#808080";

export class ArtworkProblem extends Error {}

export type ArtworkPictures = {
  type: "image/webp" | "image/png";
  preview: Blob;
  thumb: Blob;
  check: Blob;
  width: number;
  height: number;
};

export type ReadArtwork =
  | { kind: "ready"; pictures: ArtworkPictures; print: File }
  // Kept as the print file; a PNG or JPEG of it is needed for the picture.
  | { kind: "needs-picture"; print: File; why: string };

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function fromImage(blob: Blob, fallbackSize = 1000): Promise<Drawable> {
  if (blob.type !== "image/svg+xml") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to an <img>
    }
  }
  // An SVG is drawn through an <img>: scripts in it never run there.
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ArtworkProblem("That picture couldn't be read. Try a PNG or JPEG.");
  }
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (!width || !height) {
    width = fallbackSize;
    height = fallbackSize;
  }
  // A small SVG drawn large stays sharp: scale its box up before drawing.
  if (blob.type === "image/svg+xml" && Math.max(width, height) < 2000) {
    const scale = 2000 / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new ArtworkProblem("This browser can't draw pictures.");
  return { canvas, context };
}

function drawAt(source: CanvasImageSource, width: number, height: number, maxSide: number, fill: string | null) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const { canvas, context } = canvasOf(width * scale, height * scale);
  if (fill) {
    context.fillStyle = fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function free(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

// Nothing but transparent or near-white pixels: a PDF page with nothing
// drawn on it, or an Illustrator file's placeholder page.
function looksBlank(canvas: HTMLCanvasElement) {
  const probe = drawAt(canvas, canvas.width, canvas.height, 200, null);
  const data = probe.getContext("2d")!.getImageData(0, 0, probe.width, probe.height).data;
  free(probe);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 16 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235)) return false;
  }
  return true;
}

// WebP keeps transparency; where the browser hands back something else
// (Safari makes PNG), PNG it is. Stepped down until it fits.
async function makePictures(drawable: Drawable, name: string): Promise<ArtworkPictures> {
  const { source, width, height } = drawable;
  if (!width || !height) throw new ArtworkProblem(`${name} couldn't be read.`);
  let type: "image/webp" | "image/png" = "image/webp";
  let preview: Blob | null = null;
  let big: HTMLCanvasElement | null = null;
  for (const side of PREVIEW_SIDES) {
    const canvas = drawAt(source, width, height, side, null);
    let blob = type === "image/webp" ? await encode(canvas, "image/webp", 0.92) : null;
    if (type === "image/webp" && (!blob || blob.type !== "image/webp")) type = "image/png";
    if (type === "image/png") blob = await encode(canvas, "image/png");
    if (blob && blob.size <= CAPS.preview) {
      preview = blob;
      big = canvas;
      break;
    }
    free(canvas);
  }
  if (!preview || !big) throw new ArtworkProblem(`${name} is too detailed to make a picture of. Add a smaller PNG of it.`);
  const thumbCanvas = drawAt(big, big.width, big.height, 400, null);
  const thumb = await encode(thumbCanvas, type, type === "image/webp" ? 0.85 : undefined);
  const checkCanvas = drawAt(big, big.width, big.height, 512, MID_GREY);
  const check = await encode(checkCanvas, "image/jpeg", 0.85);
  const result = { width: big.width, height: big.height };
  free(thumbCanvas);
  free(checkCanvas);
  free(big);
  if (!thumb || thumb.size > CAPS.thumb || !check || check.size > CAPS.check) {
    throw new ArtworkProblem(`${name} couldn't be made small enough. Add a smaller PNG of it.`);
  }
  return { type, preview, thumb, check, ...result };
}

async function fromPdf(file: File): Promise<Drawable | string> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== "%PDF-") return "This file has no picture a browser can draw.";
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return "This file couldn't be opened as a PDF.";
  }
  try {
    const page = await pdf.getPage(1);
    const text = await page.getTextContent().catch(() => null);
    const words = (text?.items ?? []).map((item) => ("str" in item ? item.str : "")).join(" ");
    if (/saved without PDF Content/i.test(words)) {
      return "This Illustrator file was saved without a picture inside it.";
    }
    const base = page.getViewport({ scale: 1 });
    // A big artboard is drawn at no more than 2000 px on its long side:
    // a phone's browser can't hold a bigger canvas.
    const scale = Math.min(4, 2000 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const { canvas, context } = canvasOf(viewport.width, viewport.height);
    await page.render({ canvasContext: context, canvas, viewport, background: "rgba(0,0,0,0)" }).promise;
    if (looksBlank(canvas)) {
      free(canvas);
      return "Nothing showed on this file's first page.";
    }
    return { source: canvas, width: canvas.width, height: canvas.height, close: () => free(canvas) };
  } catch {
    return "This file couldn't be drawn.";
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

// One file from the person: the printer's file, and a picture made from it
// when a browser can draw it.
export async function readArtworkFile(file: File): Promise<ReadArtwork> {
  if (file.size > ARTWORK_ORIGINAL_MAX) throw new ArtworkProblem(`${file.name} is over 50 MB.`);
  if (!file.size) throw new ArtworkProblem(`${file.name} is empty.`);
  const ext = extOf(file.name);
  if (RASTER.includes(file.type) || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    const drawable = await fromImage(file);
    try {
      return { kind: "ready", pictures: await makePictures(drawable, file.name), print: file };
    } finally {
      drawable.close();
    }
  }
  if (file.type === "image/svg+xml" || ext === "svg") {
    const svg = file.type === "image/svg+xml" ? file : new Blob([await file.arrayBuffer()], { type: "image/svg+xml" });
    const drawable = await fromImage(svg);
    try {
      return { kind: "ready", pictures: await makePictures(drawable, file.name), print: file };
    } finally {
      drawable.close();
    }
  }
  if (file.type === "application/pdf" || ext === "pdf" || ext === "ai") {
    const drawn = await fromPdf(file);
    if (typeof drawn === "string") return { kind: "needs-picture", print: file, why: drawn };
    try {
      return { kind: "ready", pictures: await makePictures(drawn, file.name), print: file };
    } finally {
      drawn.close();
    }
  }
  if (["eps", "ps", "psd", "tif", "tiff", "cdr"].includes(ext)) {
    return { kind: "needs-picture", print: file, why: `A browser can't draw a .${ext} file.` };
  }
  throw new ArtworkProblem("Add the artwork as AI, EPS, PDF, SVG, PNG, JPG, TIFF or PSD.");
}

// The picture for a file a browser can't draw: a PNG or JPEG of the same logo.
export async function readArtworkPicture(file: File): Promise<ArtworkPictures> {
  const ext = extOf(file.name);
  if (!(RASTER.includes(file.type) || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext))) {
    throw new ArtworkProblem("Add the picture as a PNG or JPEG.");
  }
  if (file.size > 25 * 1024 * 1024) throw new ArtworkProblem(`${file.name} is over 25 MB.`);
  const drawable = await fromImage(file);
  try {
    return await makePictures(drawable, file.name);
  } finally {
    drawable.close();
  }
}

export function artworkNameFrom(fileName: string) {
  return (
    fileName
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Artwork"
  );
}
