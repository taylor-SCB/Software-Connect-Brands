// Where the first sentence ends (audit fix, Nov 12, 2026): not at a period
// inside “quotes” (an entry titled “Follow up · Dr. Smith”), after a common
// abbreviation (Dr. Inc. Co. St. …) or after a single initial (J. R. Lee),
// and only when a space or the end follows.
const ABBREVIATIONS = new Set(["dr", "mr", "mrs", "ms", "jr", "sr", "st", "inc", "co", "corp", "ltd", "llc", "vs", "no", "ave", "mt", "ft", "etc", "e.g", "i.e"]);

export function firstSentence(text: string) {
  let quoted = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "“") quoted += 1;
    else if (ch === "”") quoted = Math.max(0, quoted - 1);
    else if (ch === '"') quoted = quoted ? 0 : 1;
    if (quoted || !".!?".includes(ch)) continue;
    const next = text[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    if (ch === ".") {
      const word = /([A-Za-z.]+)$/.exec(text.slice(0, i))?.[1] ?? "";
      if (word.length === 1 || ABBREVIATIONS.has(word.toLowerCase())) continue;
    }
    return text.slice(0, i + 1);
  }
  return text;
}
