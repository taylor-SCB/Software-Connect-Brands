// The number to dial or text, without an extension: "(512) 555-0100 x204"
// is 5125550100, never 5125550100204 (lists audit L30, Nov 11, 2026). A call
// waits and then dials the extension (the comma); a text never carries it.
// Pure and browser-safe: every tel: and sms: link in the app goes through
// these (the lists' cells, Up next, the Pipeline panel, the Rundown, the
// calendar, the contact and company pages, Mark as sent's text).
const EXTENSION = /\s*(?:x|ext\.?|extension)\s*(\d+)\s*$/i;

export function dialNumber(number: string) {
  const match = number.match(EXTENSION);
  const main = (match ? number.slice(0, match.index) : number).replace(/[^\d+]/g, "");
  return { main, extension: match?.[1] ?? null };
}

export function telHref(number: string) {
  const { main, extension } = dialNumber(number);
  return `tel:${main}${extension ? `,${extension}` : ""}`;
}

export function smsHref(number: string) {
  return `sms:${dialNumber(number).main}`;
}
