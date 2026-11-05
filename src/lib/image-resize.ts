// Release 3b: a product picture made ready in the browser before it is
// sent, so a 12-megapixel phone photo never travels and nothing the phone
// wrote into it (GPS, camera) does either — redrawing on a canvas keeps
// only the pixels. Three copies:
//   display  up to 1600 px, WebP (JPEG where the browser can't make WebP)
//   thumb    up to 400 px, same type, for lists and the quote editor
//   doc      up to 160 px, always JPEG on white, for quotes, their PDFs and
//            partner ratesheets: Chrome puts a JPEG into a PDF as it is.
// Safari can't make WebP and quietly hands back a PNG instead, which is
// checked after every encode: then both larger copies are JPEG, drawn on
// white so a transparent cut-out doesn't turn black.

export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const CAPS = { display: 2 * 1024 * 1024, thumb: 300 * 1024, doc: 60 * 1024 };

export type ResizedPicture = {
  type: "image/webp" | "image/jpeg";
  display: Blob;
  thumb: Blob;
  doc: Blob;
  width: number;
  height: number;
};

export class PictureProblem extends Error {}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

// createImageBitmap turns a phone's sideways photo the right way up; an
// <img> does the same in browsers too old for that option.
async function decode(file: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      throw new PictureProblem("That picture couldn't be read. Try a JPEG or PNG.");
    }
  }
}

function draw(source: CanvasImageSource, width: number, height: number, maxSide: number, white: boolean) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new PictureProblem("This browser can't resize pictures.");
  if (white) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function free(...canvases: HTMLCanvasElement[]) {
  for (const canvas of canvases) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// The smallest of a few tries that fits under the cap, as the type asked
// for. Null when the browser made something else (Safari's PNG).
async function fit(
  make: (maxSide: number) => HTMLCanvasElement,
  sides: number[],
  type: "image/webp" | "image/jpeg",
  cap: number,
): Promise<{ blob: Blob; canvas: HTMLCanvasElement } | null | "too-big"> {
  for (const side of sides) {
    const canvas = make(side);
    for (const quality of [0.85, 0.7]) {
      const blob = await encode(canvas, type, quality);
      if (!blob || blob.type !== type) {
        free(canvas);
        return null;
      }
      if (blob.size <= cap) return { blob, canvas };
    }
    free(canvas);
  }
  return "too-big";
}

export async function resizePicture(file: File): Promise<ResizedPicture> {
  if (!(ACCEPTED_PICTURE_TYPES as readonly string[]).includes(file.type)) {
    throw new PictureProblem(`${file.name} isn't a JPEG, PNG, WebP or GIF picture.`);
  }
  if (file.size > MAX_ORIGINAL_BYTES) throw new PictureProblem(`${file.name} is over 25 MB.`);

  const decoded = await decode(file);
  try {
    const { source, width, height } = decoded;
    if (!width || !height) throw new PictureProblem(`${file.name} couldn't be read.`);

    const tooBig = () => new PictureProblem(`${file.name} is too detailed to make small enough. Try another picture.`);
    let type: "image/webp" | "image/jpeg" = "image/webp";
    let display = await fit((side) => draw(source, width, height, side, false), [1600, 1200], "image/webp", CAPS.display);
    if (display === null) {
      type = "image/jpeg";
      display = await fit((side) => draw(source, width, height, side, true), [1600, 1200], "image/jpeg", CAPS.display);
    }
    if (display === null || display === "too-big") throw tooBig();
    const big = display.canvas;

    const thumb = await fit((side) => draw(big, big.width, big.height, side, type === "image/jpeg"), [400, 300], type, CAPS.thumb);
    const doc = await fit((side) => draw(big, big.width, big.height, side, true), [160, 120], "image/jpeg", CAPS.doc);
    const result = {
      type,
      display: display.blob,
      width: big.width,
      height: big.height,
      thumb: thumb && thumb !== "too-big" ? thumb.blob : null,
      doc: doc && doc !== "too-big" ? doc.blob : null,
    };
    free(big);
    if (thumb && thumb !== "too-big") free(thumb.canvas);
    if (doc && doc !== "too-big") free(doc.canvas);
    if (!result.thumb || !result.doc) throw tooBig();
    return result as ResizedPicture;
  } finally {
    decoded.close();
  }
}
