// Pictures made small in the browser before they go to the AI (Release C,
// Nov 12, 2026). A job photo can be a 12-megapixel phone shot; the AI
// needs about 1,000 px, and Vercel refuses a request body over 4.5 MB, so
// every picture is redrawn on a canvas (which also drops what the phone
// wrote into it: GPS, camera) and sent as JPEG bytes, never as a storage
// address. Browser only.

export class PictureReadProblem extends Error {}

// Under Vercel's 4.5 MB request limit with room for the rest of the
// request, counted in base64 characters (what actually travels).
export const AI_REQUEST_BUDGET = 3_600_000;

async function decode(source: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    return { draw: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(source);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { draw: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new PictureReadProblem("That picture couldn't be read. Try a JPEG or PNG.");
    }
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new PictureReadProblem("That picture couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

// One picture as JPEG base64, at most `maxSide` px on its long side, drawn
// on white so a transparent cut-out doesn't turn black.
export async function pictureForAi(source: Blob, maxSide = 1024, quality = 0.7): Promise<string> {
  const decoded = await decode(source);
  try {
    if (!decoded.width || !decoded.height) throw new PictureReadProblem("That picture couldn't be read.");
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new PictureReadProblem("This browser can't resize pictures.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.draw, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new PictureReadProblem("This browser can't resize pictures.");
    return toBase64(blob);
  } finally {
    decoded.close();
  }
}

// A stored job photo, fetched through this site (same origin, ?stream=1)
// so it can be drawn on a canvas.
export async function fetchPicture(src: string): Promise<Blob> {
  const url = `${src}${src.includes("?") ? "&" : "?"}stream=1`;
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new PictureReadProblem("A photo couldn't be loaded. Reload the page and try again.");
  return response.blob();
}

// Several pictures for one request, kept under the request budget: tried
// at 1,024 px and quality 0.7, then smaller, until they fit together.
export async function picturesForAi(sources: Blob[], budget = AI_REQUEST_BUDGET): Promise<string[]> {
  const steps: [number, number][] = [
    [1024, 0.7],
    [800, 0.6],
    [640, 0.55],
    [512, 0.5],
  ];
  for (const [side, quality] of steps) {
    const out: string[] = [];
    let total = 0;
    for (const source of sources) {
      const base64 = await pictureForAi(source, side, quality);
      total += base64.length;
      out.push(base64);
      if (total > budget) break;
    }
    if (total <= budget && out.length === sources.length) return out;
  }
  throw new PictureReadProblem("Those photos are too much to send at once. Pick fewer.");
}
