"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { draftQuoteLines, type DraftedLine } from "../ai-actions";

// "Draft lines from the meeting" (Nov 10, 2026): asks for lines drawn
// from the opportunity's meeting notes and hands them to the editor,
// which adds them unsaved for review. `auto` runs it once on arrival, when
// the person ticked it on the Pipeline's Build Quote.
export function MeetingDraftButton({ quoteId, auto, onLines }: { quoteId: string; auto: boolean; onLines: (lines: DraftedLine[]) => void }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; info?: string }>({});
  const ran = useRef(false);

  function run() {
    setMessage({});
    start(async () => {
      const result = await draftQuoteLines(quoteId);
      if ("error" in result) {
        setMessage({ error: result.error });
        return;
      }
      onLines(result.lines);
      const typed = result.lines.filter((line) => line.kind === "typed").length;
      const parts = [
        result.lines.length === 0
          ? "Nothing in the notes to add."
          : `Added ${result.lines.length} ${result.lines.length === 1 ? "line" : "lines"} below. Check them, then Save.`,
        typed ? `${typed} ${typed === 1 ? "needs a price" : "need prices"}.` : "",
        result.dropped
          ? `${result.dropped} ${result.dropped === 1 ? "line named a product" : "lines named products"} not in your catalog and ${result.dropped === 1 ? "was" : "were"} left out.`
          : "",
      ];
      setMessage({ info: parts.filter(Boolean).join(" ") });
    });
  }

  useEffect(() => {
    if (!auto || ran.current) return;
    ran.current = true;
    // Once only: a reload of the page doesn't ask again. A null state,
    // as Next's docs show, so its router takes the new address too (audit
    // fix, Nov 10, 2026): passing Next's own state skipped that, and the
    // next save put ?draft=meeting back in the address bar.
    window.history.replaceState(null, "", window.location.pathname);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, [auto]);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={pending} className="btn btn-ghost btn-sm" data-testid="quote-draft-meeting">
        <IconSparkles size={13} />
        {pending ? "Reading the meeting…" : "Draft lines from the meeting"}
      </button>
      {message.error && (
        <span className="text-xs text-[var(--danger)]" data-testid="quote-draft-error">
          {message.error}
        </span>
      )}
      {message.info && (
        <span className="faint text-xs" data-testid="quote-draft-info">
          {message.info}
        </span>
      )}
    </span>
  );
}
