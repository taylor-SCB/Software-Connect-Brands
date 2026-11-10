// The two looks (Nov 10, 2026; Taylor: "same layout and design but one is
// a black backdrop and the other white"). Pure, so the switch in the
// browser and the server read the same list. Saved per person on
// User.theme; a signed-out visitor's pick lives in the THEME_COOKIE
// cookie. Any other stored value (an old "bright") reads Dark.
export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
};

export const THEME_COOKIE = "scb-look";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function parseTheme(value: unknown): Theme {
  return isTheme(value) ? value : "dark";
}
