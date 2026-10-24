import { Unzip, UnzipInflate } from "fflate";
import { decodeText } from "@/lib/price-list-file";

// Turns an uploaded agreement into the plain text a template body holds.
// It runs in the browser, not on the server: Word and PDF readers unpack
// the whole file in memory, and a small file built to unpack to gigabytes
// would otherwise take the server down for everyone on it. Here the worst
// it can do is the uploader's own tab. Nothing is saved until Save, so
// the text only ever reaches the server through the ordinary form.
//
// Word keeps its paragraphs; a PDF keeps its words but not its layout; a
// Google Doc comes in as the Word file Google downloads it as.

// Not sent anywhere, so it can be larger than the 4 MB documents: Word
// files with a logo or photos in them are often 5 to 10 MB.
export const TEMPLATE_FILE_MAX_BYTES = 20 * 1024 * 1024;
// Same as the template body's own limit.
export const TEMPLATE_MAX_CHARS = 60000;
// The words of a 60,000-character agreement are a few megabytes of Word
// XML at most; anything far past that is padding or a trap.
const MAX_DOCX_XML_BYTES = 12 * 1024 * 1024;
// A long contract is 40 pages. A 300-page PDF is a manual or a catalog,
// and every page read costs time and memory.
const MAX_PDF_PAGES = 300;

export async function readAgreementFile(file: File): Promise<{ text: string } | { error: string }> {
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > TEMPLATE_FILE_MAX_BYTES) return { error: "Keep the file under 20 MB." };

  const name = file.name.toLowerCase();
  let text = "";
  try {
    if (name.endsWith(".docx")) {
      const buffer = await file.arrayBuffer();
      const problem = inspectDocx(new Uint8Array(buffer));
      if (problem) return { error: problem };
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
    } else if (name.endsWith(".pdf")) {
      const read = await readPdfText(new Uint8Array(await file.arrayBuffer()));
      if ("error" in read) return read;
      text = read.text;
    } else if (name.endsWith(".txt")) {
      // Old Notepad saves Windows-1252 ("ANSI") or UTF-16 ("Unicode");
      // read as UTF-8, both came in as junk.
      text = decodeText(new Uint8Array(await file.arrayBuffer())).replace(/^﻿/, "").replace(/\u0000/g, "");
    } else if (name.endsWith(".doc")) {
      return { error: "That's the old Word format. Open it in Word and Save As .docx, then upload that." };
    } else {
      return { error: "Upload a Word (.docx), PDF or text file. For a Google Doc: File → Download → Microsoft Word." };
    }
  } catch {
    return { error: "That file couldn't be read. If it opens fine on your computer, save it again as .docx and retry." };
  }

  text = tidy(text);
  if (text.length < 20) {
    return {
      error: name.endsWith(".pdf")
        ? "This PDF has no readable text — it looks like a scan. Upload the Word version instead."
        : "There's almost no text in that file.",
    };
  }
  if (text.length > TEMPLATE_MAX_CHARS) return { error: tooLong() };
  return { text };
}

function tooLong() {
  return `That agreement is longer than a template can hold (${TEMPLATE_MAX_CHARS.toLocaleString("en-US")} characters).`;
}

// Word's extraction leaves runs of blank lines and stray spaces at line
// ends; three blank lines become one so the body reads like the original.
function tidy(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Unpacks the .docx's XML parts as a stream, counting as it goes, and
// stops at the limit: the sizes a zip declares can lie, the bytes can't.
// Pictures and embedded fonts are skipped; the Word reader never opens
// them.
function inspectDocx(bytes: Uint8Array): string | null {
  let unpacked = 0;
  let problem: string | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (problem || !/\.(xml|rels)$/i.test(file.name)) return;
    file.ondata = (error, chunk) => {
      if (error || problem) return;
      unpacked += chunk.length;
      if (unpacked > MAX_DOCX_XML_BYTES) {
        problem = "That Word file unpacks to far more than an agreement should. Open it in Word, Save As a new .docx, and try again.";
        file.terminate();
      }
    };
    file.start();
  };
  try {
    unzip.push(bytes, true);
  } catch {
    // Not a zip at all: the Word reader says so in its own words.
  }
  return problem;
}

// Page by page, stopping at the template's limit, so a long PDF is
// refused after the pages that fill a template, not after all of them.
async function readPdfText(bytes: Uint8Array): Promise<{ text: string } | { error: string }> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      return { error: `That PDF is ${pdf.numPages.toLocaleString("en-US")} pages. Upload just the agreement (up to ${MAX_PDF_PAGES} pages).` };
    }
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      const page = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("");
      pages.push(page);
      length += page.length;
      // Tidying trims spaces and blank lines, not words, so twice the
      // limit is past saving.
      if (length > TEMPLATE_MAX_CHARS * 2) return { error: tooLong() };
    }
    return { text: pages.join("\n\n") };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
