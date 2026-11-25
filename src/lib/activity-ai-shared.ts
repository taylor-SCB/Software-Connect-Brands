import type { ActivityOutcomeValue, ActivityTypeValue, NoteLabelValue, StatusReasonValue } from "@/lib/constants";

// Activity AI (Pipeline AI, Release 1, Nov 25, 2026; plan: the "Pipeline AI
// Plan" artifact). What the bar on the Pipeline hands the browser after the
// AI has read a sentence, and what a card sends back to be saved. Browser
// safe: no database here. The reading and matching are in
// src/lib/activity-ai.ts; the save is activity-ai-actions.ts under deals.
//
// A sentence becomes one card per thing it says (Taylor's decision 7):
// - LOG: a call, text, email or meeting that happened (logActivity).
// - BOOK: a meeting still ahead (bookMeeting, Meeting Set).
// - SCHEDULE: a call, text or email to make on a day ahead (logActivity
//   with that day: an open calendar entry, no history yet).
// - NOTE: something to remember about a person, Personal or not.
// Nothing else is added: no follow-up the words don't say (Taylor, "no
// follow up logic").

export const CARD_KINDS = ["LOG", "BOOK", "SCHEDULE", "NOTE"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const DEAL_CHOICES = ["NONE", "QUOTE", "PRICED"] as const;
export type DealChoice = (typeof DEAL_CHOICES)[number];

// Someone already in the workspace that a person or company named in the
// words may be. `strong` is a match by email, phone, or the exact name at
// the same company; anything weaker only ever offers itself in the "Is this
// the same person?" box.
export type PersonCandidate = {
  id: string;
  name: string;
  companyId: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  reason: string;
  strong: boolean;
};

export type CompanyCandidate = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  reason: string;
  strong: boolean;
};

// A person or company as said, and what it is in the workspace: Found (an
// id), New, or not decided yet (null, the box asks). Shared by every card
// from the same sentence, so Sue picked once is Sue on both cards.
export type SaidPerson = { name: string; title: string | null; email: string | null; phone: string | null; companyKey: string | null };
export type SaidCompany = { name: string; phone: string | null; website: string | null; city: string | null; state: string | null };

// `confirmed`: the person answered "Is this the same person?" with "No, make
// a new one", so Save doesn't ask again.
export type Pick = { kind: "found"; id: string } | { kind: "new"; confirmed?: boolean } | null;

export type CardPerson = { key: string; said: SaidPerson; pick: Pick; candidates: PersonCandidate[] };
export type CardCompany = { key: string; said: SaidCompany; pick: Pick; candidates: CompanyCandidate[] };

export type ActivityCard = {
  id: string;
  kind: CardKind;
  type: ActivityTypeValue | null;
  outcome: ActivityOutcomeValue | null;
  day: string | null;
  time: string | null;
  notes: string;
  noteLabel: NoteLabelValue | null;
  personKeys: string[];
  companyKey: string | null;
  interest: "INTERESTED" | "NOT_INTERESTED" | null;
  reason: StatusReasonValue | null;
  deal: DealChoice;
  valueCents: number | null;
  dealTitle: string;
  where: string | null;
};

// An open Pipeline tile a found person is on, for the card's Pipeline line.
export type OpenTile = { id: string; title: string; column: string; columnKey: string; hasDeal: boolean };

export type ReadResult = {
  cards: ActivityCard[];
  people: CardPerson[];
  companies: CardCompany[];
  // Found people's open tiles, by contact id.
  tiles: Record<string, OpenTile[]>;
  // Contact id -> name and company, for people picked from a candidate.
  today: string;
  now: string;
  meId: string;
  users: { id: string; name: string }[];
  // Parts of the answer that didn't check out against the words.
  dropped: number;
};

// What Save hands back: the toast's words, the signed Undo, the records the
// save made (so the other cards from the same sentence use them), and where
// to go next for Build Quote.
export type SaveResult =
  | {
      ok: true;
      words: string;
      undo: string | null;
      created: { key: string; kind: "person" | "company"; id: string }[];
      quoteUrl?: string;
      opportunityId?: string | null;
    }
  | { ok: false; error: string; people?: Record<string, PersonCandidate[]>; companies?: Record<string, CompanyCandidate[]> };

// How the card's Pipeline line reads. `tiles` are the open tiles of the
// people on the card (found ones only; a new person has none yet).
export function pipelineLine(card: ActivityCard, tiles: OpenTile[], hasPerson: boolean, dealOn = false): string {
  const base = baseLine(card, tiles, hasPerson);
  if (!dealOn) return base;
  return card.deal === "PRICED" ? `${base} Then a deal at Quote Sent.` : `${base} Then a deal, and its new quote opens.`;
}

function baseLine(card: ActivityCard, tiles: OpenTile[], hasPerson: boolean): string {
  const tile = tiles[0];
  if (card.kind === "NOTE") return "A note on their record. It isn't a touch.";
  if (card.kind === "SCHEDULE") return "On your calendar for that day. Nothing is logged until it happens.";
  if (card.kind === "BOOK") return tile ? `Booked on ${tile.title} (${tile.column}).` : "A new tile in Meeting Set.";
  if (card.type === "MEETING") {
    if (card.outcome === "NO_SHOW") return "Marked a no-show. The tile stays where it is.";
    return tile ? `Joins ${tile.title} and moves it to Meeting Completed.` : "A new tile in Meeting Completed.";
  }
  if (!hasPerson) return "Waits on the company's page to be linked to a person.";
  return "On their history. It stays off the board.";
}

// Plain dollars from cents, for the card's value box.
export function centsToDollarText(cents: number | null) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
