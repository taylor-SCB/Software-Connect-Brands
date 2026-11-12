import { prisma } from "@/lib/prisma";

// C3, the close-out photo report (Release C, Nov 12, 2026): which photos
// are "before" and which "after", and the pairs the rules make without any
// AI. Claude only rewrites the pairing and writes the words; a person edits
// and saves. Server only.

export const REPORT_MAX_PAIRS = 10;

export type ReportPhoto = {
  id: string;
  src: string;
  name: string;
  takenOn: string;
  types: string[];
  locations: string[];
  role: "before" | "after";
};

export type ReportPair = { beforeId: string; afterId: string; line: string };

const BEFORE = /\b(site walk|before|existing|demo)\b/i;
const AFTER = /\b(finished|after|complete|completed|final)\b/i;

// Every picture on the job that can be in a report: its own photos, not
// receipts, not videos, oldest first.
export async function jobReportPhotos(organizationId: string, projectId: string) {
  const rows = await prisma.upload.findMany({
    where: {
      organizationId,
      projectId,
      kind: "PROJECT_FILE",
      storageKey: { not: null },
      mimeType: { in: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
      receipt: null,
    },
    orderBy: { createdAt: "asc" },
    take: 400,
    select: {
      id: true,
      name: true,
      publicToken: true,
      createdAt: true,
      tags: { select: { tag: { select: { kind: true, name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    src: `/files/${row.publicToken}`,
    name: row.name,
    takenOn: row.createdAt.toISOString().slice(0, 10),
    types: row.tags.filter((link) => link.tag.kind === "TYPE").map((link) => link.tag.name),
    locations: row.tags.filter((link) => link.tag.kind === "LOCATION").map((link) => link.tag.name),
  }));
}

type Photo = Awaited<ReturnType<typeof jobReportPhotos>>[number];

// Before and after by Photo Type where the photos carry one (Site Walk /
// Finished Install), else by date: the earlier half before, the later
// half after. Pairs match a Location / Area first, then go in order.
export function pairByRules(photos: Photo[]): { candidates: ReportPhoto[]; pairs: ReportPair[] } {
  const isBefore = (photo: Photo) => photo.types.some((type) => BEFORE.test(type));
  const isAfter = (photo: Photo) => photo.types.some((type) => AFTER.test(type));
  let before = photos.filter((photo) => isBefore(photo) && !isAfter(photo));
  let after = photos.filter((photo) => isAfter(photo) && !isBefore(photo));
  if (before.length === 0 || after.length === 0) {
    const half = Math.floor(photos.length / 2);
    before = photos.slice(0, half);
    after = photos.slice(half);
  }
  // The latest "after" shots and the earliest "before" ones.
  after = after.slice(-REPORT_MAX_PAIRS);
  before = before.slice(0, REPORT_MAX_PAIRS * 2);

  const used = new Set<string>();
  const pairs: ReportPair[] = [];
  for (const shot of after) {
    const match =
      before.find((photo) => !used.has(photo.id) && photo.locations.some((place) => shot.locations.includes(place))) ??
      before.find((photo) => !used.has(photo.id));
    if (!match) break;
    used.add(match.id);
    pairs.push({ beforeId: match.id, afterId: shot.id, line: "" });
  }
  const inPairs = new Set(pairs.flatMap((pair) => [pair.beforeId, pair.afterId]));
  const candidates: ReportPhoto[] = photos
    .filter((photo) => inPairs.has(photo.id))
    .map((photo) => ({ ...photo, role: pairs.some((pair) => pair.beforeId === photo.id) ? "before" : "after" }));
  return { candidates, pairs };
}

// A stored or posted list of pairs, kept only where both photos are on
// this job, differ, and each photo is in one pair at most.
export function cleanPairs(raw: unknown, allowed: Set<string>): ReportPair[] {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  const pairs: ReportPair[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { beforeId, afterId, line } = entry as Record<string, unknown>;
    if (typeof beforeId !== "string" || typeof afterId !== "string" || beforeId === afterId) continue;
    if (!allowed.has(beforeId) || !allowed.has(afterId) || used.has(beforeId) || used.has(afterId)) continue;
    used.add(beforeId);
    used.add(afterId);
    pairs.push({ beforeId, afterId, line: typeof line === "string" ? line.trim().slice(0, 300) : "" });
    if (pairs.length >= REPORT_MAX_PAIRS * 2) break;
  }
  return pairs;
}
