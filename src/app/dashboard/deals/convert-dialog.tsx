"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { BOARD_DEAL_STAGES, PIPELINE_COLUMN_COLORS, type PipelineColumn } from "@/lib/constants";
import { dollarsToCents } from "@/lib/format";
import { IconX } from "@/components/icons";
import { convertOpportunity } from "./opportunity-actions";

type Stage = (typeof BOARD_DEAL_STAGES)[number];

// Taylor's wording, Oct 27, 2026.
const CHOICES: { stage: Stage; label: string; noun: string }[] = [
  { stage: "QUOTE_SENT", label: "Yes – Move to Quote", noun: "Quote" },
  { stage: "CONTRACT_SENT", label: "Yes – Move to Contract", noun: "Contract" },
  { stage: "WON", label: "Yes – Move to Signed / Won", noun: "Signed / Won" },
  { stage: "LOST", label: "Yes – Move to Lost", noun: "Lost" },
];

// "Do you want to convert this to a deal?" — one stage, then Build Quote
// or Manual Input under it, then Save and Accept. Opened by dropping a
// tile with no deal on Quote Sent or further (that column picked to
// start), or from Convert on a tile or its panel.
export function ConvertDialog({
  tile,
  stage,
  today,
  onClose,
  onDone,
}: {
  tile: { id: string; title: string };
  stage: PipelineColumn;
  today: string;
  onClose: () => void;
  onDone: (quoteUrl?: string) => void;
}) {
  const [picked, setPicked] = useState<Stage | null>((BOARD_DEAL_STAGES as readonly string[]).includes(stage) ? (stage as Stage) : null);
  const [mode, setMode] = useState<"quote" | "manual" | null>(null);
  const [title, setTitle] = useState(tile.title);
  const [value, setValue] = useState("");
  const [on, setOn] = useState(today);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  function save() {
    if (!picked || !mode) return;
    setError(undefined);
    start(async () => {
      const result = await convertOpportunity({
        id: tile.id,
        stage: picked,
        mode,
        title,
        valueCents: mode === "manual" ? dollarsToCents(value) : 0,
        on,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone(result.quoteUrl);
    });
  }

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="convert-title" className="card card-lit popover max-h-[92vh] w-full max-w-md overflow-y-auto p-5" data-testid="convert-dialog">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">{tile.title}</p>
            <h2 id="convert-title" className="text-base font-semibold">
              Do you want to convert this to a deal?
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm !px-1.5">
            <IconX size={14} />
          </button>
        </div>

        <div role="radiogroup" aria-label="Move to" className="space-y-2">
          {CHOICES.map((choice, index) => {
            const on_ = picked === choice.stage;
            const accent = PIPELINE_COLUMN_COLORS[choice.stage];
            return (
              <div key={choice.stage} className={`rounded-lg border p-3 ${on_ ? "border-[var(--brand)]" : "border-[var(--border)]"}`}>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                  <input
                    type="radio"
                    name="convert-stage"
                    checked={on_}
                    onChange={() => {
                      setPicked(choice.stage);
                      setMode(null);
                    }}
                    className="accent-[var(--brand)]"
                    data-testid={`convert-stage-${choice.stage}`}
                  />
                  <span className="faint num w-4">{index + 1})</span>
                  <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
                  {choice.label}
                </label>

                {on_ && (
                  <div className="mt-3 space-y-2 border-t border-[var(--border)] pl-6 pt-3" data-testid="convert-mode">
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="radio"
                        name="convert-mode"
                        checked={mode === "quote"}
                        onChange={() => setMode("quote")}
                        className="accent-[var(--brand)]"
                        data-testid="convert-mode-quote"
                      />
                      Build Quote
                    </label>
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="radio"
                        name="convert-mode"
                        checked={mode === "manual"}
                        onChange={() => setMode("manual")}
                        className="accent-[var(--brand)]"
                        data-testid="convert-mode-manual"
                      />
                      Manual Input – No Quote Needed
                    </label>

                    {mode && (
                      <div className="space-y-2 pt-1">
                        <label className="block text-xs">
                          <span className="faint">Deal name</span>
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
                            <span className="faint">Value ($)</span>
                            <input
                              value={value}
                              onChange={(event) => setValue(event.target.value)}
                              inputMode="decimal"
                              placeholder="2,500"
                              className="input input-sm num mt-1"
                              data-testid="convert-value"
                            />
                          </label>
                        )}
                        <label className="block text-xs">
                          <span className="faint">When it moved to {choice.noun}</span>
                          <input
                            type="date"
                            value={on}
                            max={today}
                            onChange={(event) => setOn(event.target.value)}
                            className="input input-sm mt-1"
                            data-testid="convert-on"
                          />
                        </label>
                        {mode === "quote" && <p className="faint text-[0.7rem]">A new quote on this deal opens after you save.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" data-testid="convert-cancel">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !picked || !mode || !title.trim() || !on}
            className="btn btn-primary btn-sm"
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
