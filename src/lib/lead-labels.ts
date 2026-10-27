// Lead Labels on an opportunity (Taylor, Oct 27, 2026). Pure, so the
// browser's chip and the server's checks read the same list.
//
// N/A (nothing picked) is light gray with red letters. Each built-in label
// has its own fixed colour, so Vendor always reads the same. A custom
// label ("+ Add Custom Lead Label") is a blank chip with neon-yellow
// letters.

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

export function leadLabelStyle(label: string | null): { background: string; color: string; borderColor: string } {
  if (!label) return { background: "#d4d4d8", color: "#dc2626", borderColor: "#d4d4d8" };
  if (isBuiltInLeadLabel(label)) {
    const color = BUILT_IN_COLORS[label];
    return { background: color, color: "#ffffff", borderColor: color };
  }
  return { background: "transparent", color: "#e8ff3a", borderColor: "rgb(232 255 58 / 0.45)" };
}
