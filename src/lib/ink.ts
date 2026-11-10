// A status, tag or stage colour used as the colour of WORDS. The app's
// pastel hues (#fbbf24, #34d399…) were picked for the dark look and are
// unreadable on white, so in Light and Bright they are mixed toward the
// text colour by the --ink token in globals.css (100% in Dark, so Dark is
// unchanged). Fills, dots and bars keep the raw colour.
export function ink(color: string): string {
  return `color-mix(in srgb, ${color} var(--ink), var(--text))`;
}
