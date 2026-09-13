// Pure helpers with no server dependencies, so the browser-side CSV
// planner can share them with the server actions.

// "Texas", "texas", "TX " and "Tex." all land on TX, so the State filter
// shows one Texas instead of four. Anything unrecognised is kept as typed
// (trimmed), which covers provinces and abroad.
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  "washington dc": "DC", "puerto rico": "PR",
};
const US_CODES = new Set(Object.values(US_STATES));

export function normalizeState(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/\.$/, "");
  if (US_STATES[key]) return US_STATES[key];
  const upper = trimmed.toUpperCase().replace(/\./g, "");
  if (upper.length === 2 && US_CODES.has(upper)) return upper;
  return trimmed.slice(0, 60);
}
