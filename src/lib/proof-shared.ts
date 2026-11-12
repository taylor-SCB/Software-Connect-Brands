// The apparel pack (Nov 12, 2026): what the browser and the server both need
// to know about proofs. No database here, so the proof sheet can import it.

export const MAX_PANELS = 4;
export const MAX_PROOFS_PER_QUOTE = 100;
export const MAX_VERSIONS = 20;
export const PROOF_MAX_BYTES = { display: 2_500_000, thumb: 300_000, doc: 90_000 } as const;
export const PROOF_TYPES = ["image/webp", "image/jpeg"] as const;
// Each panel is drawn this many pixels square before the copies are made.
export const PANEL_PX = 1000;

export type ProofStatusValue = "DRAFT" | "SENT" | "APPROVED" | "CHANGES" | "SUPERSEDED";

export const PROOF_STATUS_TEXT: Record<ProofStatusValue, string> = {
  DRAFT: "Draft",
  SENT: "Waiting for approval",
  APPROVED: "Approved",
  CHANGES: "Changes asked",
  SUPERSEDED: "Replaced",
};

export type Placement = { x: number; y: number; w: number; h: number };

export type BaseKind = "picture" | "plain-front" | "plain-back";
export const BASE_KINDS: readonly BaseKind[] = ["picture", "plain-front", "plain-back"];

// Where the artwork starts on a panel, by the location's name: the usual
// spot on a t-shirt seen from the front or the back. Moved and sized by
// hand from there.
export function defaultPlacement(locationName: string | null | undefined): Placement {
  const name = (locationName ?? "").trim().toLowerCase();
  if (/left chest|chest/.test(name)) return { x: 0.56, y: 0.26, w: 0.16, h: 0.16 };
  if (/left sleeve/.test(name)) return { x: 0.1, y: 0.3, w: 0.14, h: 0.14 };
  if (/right sleeve|sleeve/.test(name)) return { x: 0.76, y: 0.3, w: 0.14, h: 0.14 };
  if (/full back|full front/.test(name)) return { x: 0.27, y: 0.24, w: 0.46, h: 0.46 };
  if (/back/.test(name)) return { x: 0.3, y: 0.24, w: 0.4, h: 0.4 };
  if (/front/.test(name)) return { x: 0.32, y: 0.28, w: 0.36, h: 0.36 };
  return { x: 0.35, y: 0.32, w: 0.3, h: 0.3 };
}

// A back view starts on the plain garment's back; everything else on its front.
export function defaultPlainSide(locationName: string | null | undefined): BaseKind {
  return /back/i.test(locationName ?? "") ? "plain-back" : "plain-front";
}

// A placement from the browser, kept inside the panel and of a sane size.
export function cleanPlacement(raw: unknown): Placement | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const nums = ["x", "y", "w", "h"].map((key) => Number(value[key]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let [x, y, w, h] = nums;
  w = Math.min(1, Math.max(0.02, w));
  h = Math.min(1, Math.max(0.02, h));
  x = Math.min(1 - w, Math.max(0, x));
  y = Math.min(1 - h, Math.max(0, y));
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// A first guess at a plain garment's colour from the Color label's words.
// Always shown in a colour box the person can change.
const COLOR_WORDS: [RegExp, string][] = [
  [/navy/, "#1f2a44"],
  [/royal/, "#2a4fa8"],
  [/(light|baby|carolina|sky) blue/, "#8fb8de"],
  [/blue/, "#2f5fb3"],
  [/maroon|burgundy/, "#6b1f2e"],
  [/cardinal|crimson/, "#9e1b32"],
  [/red/, "#c8202f"],
  [/orange/, "#e8742a"],
  [/(old )?gold|yellow/, "#d9a520"],
  [/forest|hunter|dark green/, "#24452f"],
  [/kelly|green/, "#2f8a3b"],
  [/purple/, "#55307a"],
  [/pink/, "#e889a8"],
  [/charcoal/, "#3b3d40"],
  [/heather|ash|grey|gray|silver/, "#9a9da1"],
  [/black/, "#151515"],
  [/brown|chocolate/, "#5b3a29"],
  [/tan|sand|khaki/, "#c9b28a"],
  [/cream|natural|ivory/, "#efe8d8"],
  [/white/, "#f7f7f5"],
];

export function guessGarmentColor(label: string | null | undefined): string {
  const words = (label ?? "").toLowerCase();
  for (const [pattern, hex] of COLOR_WORDS) if (pattern.test(words)) return hex;
  return "#d9d9d6";
}

// How panels sit in the one picture: side by side, four as two rows.
export function panelGrid(count: number) {
  const n = Math.max(1, Math.min(MAX_PANELS, count));
  return n === 4 ? { cols: 2, rows: 2 } : { cols: n, rows: 1 };
}

// The line a panel caption reads under the picture: "Front · Lincoln Lions
// logo · 2 colors: navy, gold".
export function panelCaption(panel: { locationLabel: string; artworkName: string; inkNote?: string | null }) {
  return [panel.locationLabel, panel.artworkName, panel.inkNote].filter(Boolean).join(" · ");
}
