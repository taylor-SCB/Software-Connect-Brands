// Lead Labels on an opportunity (Taylor, Oct 27, 2026). Pure, so the
// browser's chip and the server's checks read the same list.
//
// N/A (nothing picked) is light gray with red letters. Each built-in label
// has its own fixed colour, so Vendor always reads the same. A custom
// label ("+ Add Custom Lead Label") is a blank chip with neon-yellow
// letters.

import { ink } from "@/lib/ink";

export const BUILT_IN_LEAD_LABELS = ["Residential", "Client", "Vendor", "Software Integration", "Reseller"] as const;

// The "N/A" choice in a filter, standing for no label at all.
export const NO_LEAD_LABEL = "N/A";

const BUILT_IN_COLORS: Record<(typeof BUILT_IN_LEAD_LABELS)[number], string> = {
  Residential: "#f97316",
  Client: "#22c55e",
  Vendor: "#3b82f6",
  "Software Integration": "#a855f7",
  Reseller: "#ec4899",
};

export const MAX_LEAD_LABEL_LENGTH = 40;

export function isBuiltInLeadLabel(label: string): label is (typeof BUILT_IN_LEAD_LABELS)[number] {
  return (BUILT_IN_LEAD_LABELS as readonly string[]).includes(label);
}

// A built-in label typed in other capitals is that label.
export function canonicalLeadLabel(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_LEAD_LABEL_LENGTH);
  if (!value || value.toUpperCase() === NO_LEAD_LABEL) return null;
  return BUILT_IN_LEAD_LABELS.find((label) => label.toLowerCase() === value.toLowerCase()) ?? value;
}

// The chip's letters read at 4.5:1 or better against its own fill, in both
// looks (UX review, Nov 10, 2026: white on these bright fills was 2.3–4.0:1
// and N/A's red on gray 3.3:1). Taylor's fills stay exactly as picked; the
// letters are black on every built-in (5.3:1 on Software Integration's
// purple, the darkest of them, and more on the rest), and N/A's red is a
// deeper red on the same light gray (5.6:1).
const LEAD_LABEL_LETTERS = "#000000";
const NO_LABEL = { background: "#d4d4d8", color: "#991b1b" };

export function leadLabelStyle(label: string | null): { background: string; color: string; borderColor: string } {
  if (!label) return { ...NO_LABEL, borderColor: NO_LABEL.background };
  if (isBuiltInLeadLabel(label)) {
    const color = BUILT_IN_COLORS[label];
    return { background: color, color: LEAD_LABEL_LETTERS, borderColor: color };
  }
  return { background: "transparent", color: "var(--lead-custom)", borderColor: "color-mix(in srgb, var(--lead-custom) 45%, transparent)" };
}

// A label's colour used for WORDS on the page itself rather than on its
// chip — the dashed "Residential?" suggestion. A built-in hue goes through
// ink() (mixed toward the text colour in Light) and then 15% further toward
// the text colour, so the purple and blue clear 4.5:1 on the dark panel as
// well as on white; a custom label's neon yellow already does.
export function leadLabelInk(label: string): string {
  if (!isBuiltInLeadLabel(label)) return "var(--lead-custom)";
  return `color-mix(in srgb, ${ink(BUILT_IN_COLORS[label])} 85%, var(--text))`;
}
