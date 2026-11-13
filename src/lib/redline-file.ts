import { unzipSync, strFromU8 } from "fflate";

// Browser-only helpers for Release B's uploads (Nov 12, 2026): a picture
// made small for Claude, a PDF's page count, and a Word file's tracked
// changes. Like src/lib/template-file.ts, they run in the uploader's tab,
// never on the server.

// A photo of a page or a certificate, as a JPEG on white, at most
// `maxSide` px on the long side: about 1,568 px is what Claude reads
// best; smaller costs less. Nothing the camera wrote into the file
// (GPS, the camera) survives the redraw.
export async function pictureForAi(file: Blob, maxSide = 1568, quality = 0.8): Promise<Blob> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let close = () => {};
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    close = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("That picture couldn't be read. Try a JPEG or PNG.");
    }
    source = img;
    width = img.naturalWidth;
    height = img.naturalHeight;
    close = () => URL.revokeObjectURL(url);
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't resize pictures.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("That picture couldn't be made small enough to send.");
    return blob;
  } finally {
    close();
  }
}

// How many pages a PDF has, and its text when it has any (a scan has none).
export async function readPdf(file: Blob, maxTextChars = 60_000): Promise<{ pages: number; text: string } | { error: string }> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    try {
      const pages = pdf.numPages;
      let text = "";
      for (let number = 1; number <= Math.min(pages, 100) && text.length < maxTextChars; number += 1) {
        const content = await (await pdf.getPage(number)).getTextContent();
        text += content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join("") + "\n";
      }
      return { pages, text: text.slice(0, maxTextChars).trim() };
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch {
    return { error: "That PDF couldn't be opened. Save it again and retry." };
  }
}

// Word's tracked changes: the words inserted (<w:ins>) and deleted
// (<w:del>) in the document, in order. Called only after
// readAgreementFile has passed the file (its unpacking limits stand), and
// only the document part is unpacked.
export function readTrackedChanges(bytes: Uint8Array): { inserted: string[]; deleted: string[] } {
  const empty = { inserted: [], deleted: [] };
  let xml: string;
  try {
    const files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" });
    const part = files["word/document.xml"];
    if (!part) return empty;
    xml = strFromU8(part);
  } catch {
    return empty;
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const collect = (tag: string, textTag: string) =>
    Array.from(doc.getElementsByTagNameNS(W, tag))
      .map((node) =>
        Array.from(node.getElementsByTagNameNS(W, textTag))
          .map((text) => text.textContent ?? "")
          .join(""),
      )
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((text) => text.slice(0, 4000));
  return { inserted: collect("ins", "t"), deleted: collect("del", "delText") };
}
