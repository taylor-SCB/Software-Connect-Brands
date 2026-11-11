"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { BOARD_DEAL_STAGES, STATUS_REASONS, STATUS_REASON_LABELS, type PipelineColumn, type StatusReasonValue } from "@/lib/constants";
import { dollarsToCents } from "@/lib/format";
import { IconX } from "@/components/icons";
import { convertOpportunity } from "./opportunity-actions";

type Stage = (typeof BOARD_DEAL_STAGES)[number];

// The four cards (BDR redesign, Nov 11, 2026: the words changed, Taylor's
// Oct 27 options didn't). Quote and Contract keep Build Quote / Manual
// Input; Signed asks the amount (required); Not moving forward asks why.
const CARDS: { stage: Stage; label: string; hint: string; noun: string }[] = [
  { stage: "QUOTE_SENT", label: "Building them a quote", hint: "Quote Sent", noun: "Quote Sent" },
  { stage: "CONTRACT_SENT", label: "Sending a contract", hint: "Contract Sent", noun: "Contract Sent" },
  { stage: "WON", label: "They signed", hint: "Signed / Won · the amount is required", noun: "Won" },
  { stage: "LOST", label: "Not moving forward", hint: "Lost · tell us why if you like", noun: "Lost" },
];

// "What happened after the meeting with Blake Keller (Brazos Bend)?" —
// opened by dropping a tile with no deal on Quote Sent or further (that
// card picked to start), or from Move to… on a tile or its panel.
// - Build Quote makes the deal and opens a new quote on it; the deal stays
//   at Meeting Completed until the quote is sent (decision 19).
// - Manual Input moves it straight to the card's stage at the amount typed.
// Save and Accept, or Cancel to leave everything as it was.
export function ConvertDialog({
  tile,
  stage,
  today,
  early = false,
  onClose,
  onDone,
  ai = false,
}: {
  tile: { id: string; title: string; people?: { name: string; company: string | null }[] };
  stage: PipelineColumn;
  today: string;
  // The person already said a meeting still ahead happened early.
  early?: boolean;
  // AI on: Build Quote can draft the new quote's lines from the meeting.
  ai?: boolean;
  onClose: () => void;
  onDone: (quoteUrl?: string) => void;
}) {
  const startOn = (BOARD_DEAL_STAGES as readonly string[]).includes(stage) ? (stage as Stage) : null;
  const [picked, setPicked] = useState<Stage | null>(startOn);
  const defaultMode = (value: Stage | null) => (value === "WON" || value === "LOST" ? "manual" : null);
  const [mode, setMode] = useState<"quote" | "manual" | null>(defaultMode(startOn));
  const [title, setTitle] = useState(tile.title);
  const [value, setValue] = useState("");
  const [on, setOn] = useState(today);
  const [reason, setReason] = useState<StatusReasonValue | null>(null);
  const [draftLines, setDraftLines] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [askEarly, setAskEarly] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const person = tile.people?.[0] ?? null;
  const who = person ? `${person.name}${person.company ? ` (${person.company})` : ""}` : tile.title;
  const cents = dollarsToCents(value);
  const amountMissing = picked === "WON" && mode === "manual" && !(cents > 0);

  function save(confirmEarly = early) {
    if (!picked || !mode) return;
    setError(undefined);
    start(async () => {
      const result = await convertOpportunity({
        id: tile.id,
        stage: picked,
        mode,
        title,
        valueCents: mode === "manual" ? cents : 0,
        on,
        reason: picked === "LOST" ? reason : null,
        early: confirmEarly,
      });
      if (result.confirmEarly) {
        setAskEarly(true);
        setError(result.error);
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone(result.quoteUrl && ai && draftLines ? `${result.quoteUrl}&draft=meeting` : result.quoteUrl);
    });
  }

  const radio = "h-4 w-4 accent-[var(--brand)]";
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="convert-title" className="card card-lit popover max-h-[92vh] w-full max-w-md overflow-y-auto p-5" data-testid="convert-dialog">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1 truncate">{tile.title}</p>
            <h2 id="convert-title" className="text-base font-semibold">
              What happened after the meeting with {who}?
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm min-h-9 min-w-9 justify-center !px-1.5">
            <IconX size={14} />
          </button>
        </div>

        <div role="radiogroup" aria-label="What happened" className="space-y-2">
          {CARDS.map((card) => {
            const chosen = picked === card.stage;
            return (
              <div key={card.stage} className={`rounded-lg border p-3 ${chosen ? "border-[var(--brand)]" : "border-[var(--border)]"}`} data-testid={`convert-card-${card.stage}`}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2.5">
                  <input
                    type="radio"
                    name="convert-stage"
                    checked={chosen}
                    onChange={() => {
                      setPicked(card.stage);
                      setMode(defaultMode(card.stage));
                      setError(undefined);
                    }}
                    className={radio}
                    data-testid={`convert-stage-${card.stage}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{card.label}</span>
                    <span className="block text-xs text-[var(--text-dim)]">{card.hint}</span>
                  </span>
                </label>

                {chosen && (
                  <div className="mt-3 space-y-2 border-t border-[var(--hairline-3)] pl-6 pt-3" data-testid="convert-mode">
                    {card.stage !== "LOST" && (
                      <>
                        <label className="flex min-h-8 cursor-pointer items-start gap-2.5 text-sm">
                          <input
                            type="radio"
                            name="convert-mode"
                            checked={mode === "quote"}
                            onChange={() => setMode("quote")}
                            className={`${radio} mt-0.5`}
                            data-testid="convert-mode-quote"
                          />
                          <span>
                            {card.stage === "QUOTE_SENT" ? "Build Quote" : "Build the quote first"}
                            <span className="block text-xs text-[var(--text-dim)]">It stays at Meeting Completed until the quote is sent.</span>
                          </span>
                        </label>
                        <label className="flex min-h-8 cursor-pointer items-start gap-2.5 text-sm">
                          <input
                            type="radio"
                            name="convert-mode"
                            checked={mode === "manual"}
                            onChange={() => setMode("manual")}
                            className={`${radio} mt-0.5`}
                            data-testid="convert-mode-manual"
                          />
                          <span>
                            {card.stage === "WON" ? "Enter the amount they signed for" : "Manual Input – No Quote Needed"}
                            <span className="block text-xs text-[var(--text-dim)]">Moves it to {card.noun} now.</span>
                          </span>
                        </label>
                      </>
                    )}

                    {card.stage === "LOST" && (
                      <div>
                        <p className="mb-1.5 text-xs text-[var(--text-dim)]">Why? (optional)</p>
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Why">
                          {STATUS_REASONS.map((value) => (
                            <button
                              key={value}
                              type="button"
                              role="radio"
                              aria-checked={reason === value}
                              onClick={() => setReason(reason === value ? null : value)}
                              className={`min-h-9 rounded-lg border px-2.5 text-xs font-medium [@media(pointer:coarse)]:min-h-11 ${
                                reason === value ? "border-[var(--brand)] bg-[var(--hover)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-dim)]"
                              }`}
                              data-testid={`convert-reason-${value}`}
                            >
                              {STATUS_REASON_LABELS[value]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {mode && (
                      <div className="space-y-2 pt-1">
                        <label className="block text-xs">
                          <span className="text-[var(--text-dim)]">Deal name</span>
                          <input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            maxLength={160}
                            className="input input-sm mt-1"
                            data-testid="convert-title-input"
                          />
                        </label>
                        {mode === "manual" && (
                          <label className="block text-xs">
                            <span className="text-[var(--text-dim)]">
                              {card.stage === "WON" ? "Amount they signed for ($, required)" : card.stage === "LOST" ? "Value ($, optional)" : "Value ($)"}
                            </span>
                            <input
                              value={value}
                              onChange={(event) => setValue(event.target.value)}
                              inputMode="decimal"
                              placeholder="2,500"
                              required={card.stage === "WON"}
                              aria-invalid={amountMissing && value !== "" ? true : undefined}
                              className="input input-sm num mt-1"
                              data-testid="convert-value"
                            />
                          </label>
                        )}
                        {mode === "manual" && (
                          <label className="block text-xs">
                            <span className="text-[var(--text-dim)]">When it moved to {card.noun}</span>
                            <input
                              type="date"
                              value={on}
                              max={today}
                              onChange={(event) => setOn(event.target.value)}
                              className="input input-sm mt-1"
                              data-testid="convert-on"
                            />
                          </label>
                        )}
                        {mode === "quote" && <p className="text-xs text-[var(--text-dim)]">A new quote on this deal opens after you save.</p>}
                        {mode === "quote" && ai && (
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={draftLines}
                              onChange={(event) => setDraftLines(event.target.checked)}
                              className="accent-[var(--brand)]"
                              data-testid="convert-draft-lines"
                            />
                            Draft lines from the meeting notes (AI, prices from your catalog; you review them before saving)
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-xs text-[var(--danger)]" role="alert" data-testid="convert-error">
            {error}
          </p>
        )}
        {askEarly && (
          <button type="button" onClick={() => save(true)} className="btn btn-ghost btn-sm mt-2 min-h-9" data-testid="convert-early-yes">
            Yes, it happened early
          </button>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm min-h-9" data-testid="convert-cancel">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={pending || !picked || !mode || !title.trim() || !on || amountMissing}
            className="btn btn-primary btn-sm min-h-9"
            data-testid="convert-save"
          >
            {pending ? "Saving…" : "Save and Accept"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
