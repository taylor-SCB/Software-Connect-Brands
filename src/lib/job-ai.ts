import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";

// Shared by Release C's AI helpers on jobs, photos and money (Nov 12,
// 2026). Server only. Every picture here was made small in the browser
// (src/lib/ai-picture.ts) and arrives as JPEG bytes in base64; nothing in
// this file ever hands Anthropic a storage address.

// C2: a punch list reads at most this many photos.
export const PUNCH_MAX_PHOTOS = 20;

// One picture at most this big once decoded. The browser sends about
// 1,024 px at quality 0.7 (100 to 300 KB); a receipt or a site-walk photo
// a little bigger.
export const MAX_AI_JPEG_BYTES = 1_600_000;

// The JPEG behind a base64 string from the browser, or null when it isn't
// one (wrong bytes, too big, not a string).
export function jpegFromBase64(raw: unknown, maxBytes = MAX_AI_JPEG_BYTES): Buffer | null {
  if (typeof raw !== "string" || raw.length < 100 || raw.length > Math.ceil((maxBytes * 4) / 3) + 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 100 || bytes.length > maxBytes) return null;
  // Every JPEG starts FF D8 FF.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

export type AiImageInput = { id: string; base64: string };

// Pictures sent with ids: only well-formed JPEGs, each id once, at most
// `max`. Anything else is left out and counted.
export function readAiImages(raw: unknown, max: number): { images: { id: string; base64: string }[]; refused: number } {
  const list = Array.isArray(raw) ? raw : [];
  const images: { id: string; base64: string }[] = [];
  let refused = 0;
  for (const entry of list) {
    if (images.length >= max) {
      refused += 1;
      continue;
    }
    const id = entry && typeof entry === "object" && typeof (entry as AiImageInput).id === "string" ? (entry as AiImageInput).id.slice(0, 60) : "";
    const base64 = entry && typeof entry === "object" ? (entry as AiImageInput).base64 : null;
    if (!id || images.some((image) => image.id === id) || !jpegFromBase64(base64)) {
      refused += 1;
      continue;
    }
    images.push({ id, base64: base64 as string });
  }
  return { images, refused };
}

// Words the workspace or the person wrote, fenced so they read as data:
// a "<" inside is written &lt; so the text can't close its own fence (the
// same rule as notesForPrompt in src/lib/ai-assist.ts).
export function fenced(tag: string, text: string, attrs: Record<string, string> = {}) {
  const safe = (value: string) => value.replace(/</g, "&lt;");
  const attributes = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${safe(value).replace(/"/g, "'")}"`)
    .join("");
  return `<${tag}${attributes}>\n${safe(text)}\n</${tag}>`;
}

// The job, read for one of the helpers: its scopes and the rows of its
// signed paperwork, each with the id Claude must name back.
export async function jobScopeForAi(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      name: true,
      siteAddress: true,
      scopes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          lineItems: {
            where: { contract: { payable: false, status: "SIGNED" } },
            orderBy: { position: "asc" },
            take: 80,
            select: { id: true, name: true, description: true, quantity: true, variationText: true },
          },
        },
      },
    },
  });
  if (!project) return null;
  const lines = project.scopes.flatMap((scope) =>
    scope.lineItems.map((line) => ({ ...line, scopeId: scope.id, scopeName: scope.name })),
  );
  return { project, lines };
}

// Dollars as the facts carry them for the number check: a plain number
// and the way the page prints it, so "$1,234" and "1234.5" both match.
export function money(cents: number) {
  return { dollars: Math.round(cents) / 100, shown: formatCents(cents) };
}
