"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { IconSend, IconX } from "@/components/icons";
import type { CheckProblem } from "@/lib/contract-checks";
import { setContractStatus } from "../actions";
import { checkBeforeSend, type SendCheck } from "../ai-actions";

// "Send for signature" with B2's read before send (Release B, Nov 12,
// 2026). Every button that sends a contract is this one. The form still
// posts setContractStatus as before (and does without JavaScript); with
// JavaScript the contract is read over first, and only when something
// doesn't match is a list shown, with Send anyway and Go back and fix.
// Nothing about the contract changes on its own.
export function SendContractButton({
  contractId,
  className = "btn btn-primary btn-sm",
  formClassName,
  testId,
  label = "Send for signature",
}: {
  contractId: string;
  className?: string;
  formClassName?: string;
  testId?: string;
  label?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [checking, startCheck] = useTransition();
  const [result, setResult] = useState<SendCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  function sendNow() {
    confirmed.current = true;
    setResult(null);
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form
        ref={formRef}
        action={setContractStatus}
        className={formClassName}
        onSubmit={(event) => {
          if (confirmed.current) {
            // Once: a contract pulled back to draft is read over again.
            confirmed.current = false;
            return;
          }
          event.preventDefault();
          setError(null);
          startCheck(async () => {
            const checked = await checkBeforeSend(contractId).catch(() => null);
            if (!checked) {
              // The check itself failing never stops a send: say so and
              // let them choose.
              startCheck(() => setResult({ problems: [], dropped: 0, note: "The contract couldn't be read over just now." }));
              return;
            }
            if ("error" in checked) {
              startCheck(() => setError(checked.error));
              return;
            }
            if (checked.problems.length === 0 && !checked.note) {
              sendNow();
              return;
            }
            startCheck(() => setResult(checked));
          });
        }}
      >
        <input type="hidden" name="contractId" value={contractId} />
        <input type="hidden" name="status" value="SENT" />
        <button type="submit" disabled={checking} className={className} data-testid={testId}>
          <IconSend size={13} />
          {checking ? "Reading it over…" : label}
        </button>
        {error && (
          <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
      </form>
      {result && typeof document !== "undefined" &&
        createPortal(
          <SendCheckDialog
            result={result}
            onSend={sendNow}
            onBack={() => setResult(null)}
          />,
          document.body,
        )}
    </>
  );
}

function SendCheckDialog({ result, onSend, onBack }: { result: SendCheck; onSend: () => void; onBack: () => void }) {
  const problems: CheckProblem[] = result.problems;
  return (
    <div
      className="modal-backdrop"
      onClick={onBack}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-check-title"
        onClick={(event) => event.stopPropagation()}
        className="card card-lit popover flex max-h-[85vh] w-full max-w-lg flex-col"
        data-testid="send-check"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3.5">
          <h2 id="send-check-title" className="text-sm font-semibold">
            {problems.length > 0
              ? `${problems.length === 1 ? "One thing doesn't" : `${problems.length} things don't`} match`
              : "Send it?"}
          </h2>
          <button type="button" onClick={onBack} aria-label="Close" className="btn btn-ghost btn-sm min-h-11 sm:min-h-0">
            <IconX size={13} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {problems.length > 0 && (
            <ul className="space-y-3">
              {problems.map((problem) => (
                <li key={problem.id} className="text-sm" data-testid="send-check-item" data-code={problem.code}>
                  <span className="eyebrow mr-1">{problem.where}</span>
                  <span className="text-[var(--text-strong)]">{problem.text}</span>
                  <span className="muted block text-xs">{problem.fix}</span>
                </li>
              ))}
            </ul>
          )}
          {result.note && (
            <p className="faint mt-3 text-xs" data-testid="send-check-note">
              {result.note} {problems.length > 0 ? "The list above is from the numbers alone." : "You can still send it."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--hairline-3)] px-5 py-3">
          <button type="button" onClick={onBack} autoFocus className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="send-check-back">
            Go back and fix
          </button>
          <button type="button" onClick={onSend} className="btn btn-primary btn-sm min-h-11 sm:min-h-0" data-testid="send-check-send">
            <IconSend size={13} />
            Send anyway
          </button>
        </div>
      </div>
    </div>
  );
}
