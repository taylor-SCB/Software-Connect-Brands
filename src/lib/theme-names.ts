// The three looks (Nov 10, 2026). Pure, so the header switch in the
// browser and the server read the same list. Saved per person on
// User.theme; null reads Dark.
export const THEMES = ["dark", "light", "bright"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  bright: "Bright",
};

export function parseTheme(value: unknown): Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value) ? (value as Theme) : "dark";
}
