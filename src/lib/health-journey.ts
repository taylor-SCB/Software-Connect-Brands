import { shortDay, zoneDay } from "@/lib/health";

// DealJourney (BDR redesign, Release 8): the lifecycle meter carried on
// to the money. Meeting · Quote · Contract · Signed · Deposit, with one
// Next button, on the quote, the Contract Coordinator, the contract and
// the opportunity panel. Pure, like health.ts: the page reads the dates
// it already has and <DealJourney> draws the result.

export const JOURNEY_STEPS = ["Meeting", "Quote", "Contract", "Signed", "Deposit"] as const;
export type JourneyStepName = (typeof JOURNEY_STEPS)[number];

export type JourneyInput = {
  meetingAt: Date | null;
  quoteSentAt: Date | null;
  contractSentAt: Date | null;
  signedAt: Date | null;
  depositPaidAt: Date | null;
  // A quote made but not sent; the customer said yes to it; a contract
  // made but not sent.
  quoteDraft?: boolean;
  quoteAccepted?: boolean;
  contractDraft?: boolean;
};

export type JourneyNextKey =
  | "start-quote"
  | "send-quote"
  | "quote-yes"
  | "make-contract"
  | "send-contract"
  | "signing-link"
  | "deposit";

export type JourneyState = {
  // The step being worked on (0..4); 5 once the deposit is in.
  current: number;
  steps: { name: JourneyStepName; state: "done" | "current" | "todo"; note: string | null }[];
  // "Step 3 of 5 · Contract sent Nov 10", for the phone.
  summary: string;
  // The one Next button: Send quote → Customer said yes → Make contract →
  // Send for signature → Copy signing link → Send deposit invoice.
  next: { key: JourneyNextKey; label: string } | null;
};

export function dealJourney(input: JourneyInput, timeZone: string): JourneyState {
  const day = (at: Date | null) => (at ? shortDay(zoneDay(at, timeZone)) : null);
  const signed = input.signedAt !== null;
  const contractOut = input.contractSentAt !== null || signed;
  const quoteOut = input.quoteSentAt !== null || contractOut;
  const done = [input.meetingAt !== null || quoteOut, quoteOut, contractOut, signed, input.depositPaidAt !== null];
  let current = done.findIndex((value) => !value);
  if (current === -1) current = 5;

  const notes: (string | null)[] = [
    day(input.meetingAt),
    input.quoteSentAt
      ? input.quoteAccepted
        ? `yes, sent ${day(input.quoteSentAt)}`
        : `sent ${day(input.quoteSentAt)}`
      : input.quoteDraft
        ? "draft"
        : null,
    input.contractSentAt ? `sent ${day(input.contractSentAt)}` : input.contractDraft ? "draft" : null,
    day(input.signedAt),
    input.depositPaidAt ? `paid ${day(input.depositPaidAt)}` : null,
  ];
  const steps = JOURNEY_STEPS.map((name, index) => ({
    name,
    state: (index < current ? "done" : index === current ? "current" : "todo") as "done" | "current" | "todo",
    note: notes[index],
  }));

  let next: JourneyState["next"] = null;
  if (current <= 1) next = input.quoteDraft ? { key: "send-quote", label: "Send quote" } : { key: "start-quote", label: "Start a quote" };
  else if (current === 2)
    next = input.contractDraft
      ? { key: "send-contract", label: "Send for signature" }
      : input.quoteAccepted
        ? { key: "make-contract", label: "Make contract" }
        : { key: "quote-yes", label: "Customer said yes" };
  else if (current === 3) next = { key: "signing-link", label: "Copy signing link" };
  else if (current === 4) next = { key: "deposit", label: "Send deposit invoice" };

  // On the phone the step being worked on is named: the current one, or
  // the last one done when everything up to the deposit is in.
  const shown = Math.min(current, 4);
  const lastDone = Math.max(0, current - 1);
  const named = current >= 5 ? 4 : notes[shown] ? shown : lastDone;
  const summary =
    current >= 5
      ? "Step 5 of 5 · Deposit paid"
      : `Step ${shown + 1} of 5 · ${JOURNEY_STEPS[named]}${notes[named] ? ` ${notes[named]}` : ""}`;
  return { current, steps, summary, next };
}
