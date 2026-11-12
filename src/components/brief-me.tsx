"use client";

import { useEffect, useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { openBrief, writeBriefFor, type BriefView } from "@/app/dashboard/brief-actions";

// "Brief me" (AI release A, Nov 12, 2026): a button that opens a card of
// what is on file about one person, before a call or meeting. The facts
// show with or without AI; with AI on, opening it writes (or reuses) five
// plain lines and one thing to ask, and Rewrite asks again. Mounted on the
// contact page, Call and Meeting entries on the calendar, Up next rows and
// the Pipeline panel's Primary POC.

export function BriefMeButton({
  contactId,
  name,
  variant = "button",
  testId = "brief-me",
}: {
  contactId: string;
  name?: string;
  // "button" a ghost button; "link" small words for a crowded row.
  variant?: "button" | "link";
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          // A row or tile under it may open on a click too.
          event.stopPropagation();
          setOpen(true);
        }}
        className={variant === "link" ? "link inline-flex items-center gap-1 text-xs pointer-coarse:min-h-11" : "btn btn-ghost btn-sm pointer-coarse:min-h-11"}
        aria-label={name ? `Brief me on ${name}` : "Brief me"}
        data-testid={testId}
        data-contact-id={contactId}
      >
        <IconSparkles size={variant === "link" ? 11 : 13} />
        Brief me
      </button>
      {open && <BriefSheet contactId={contactId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function BriefSheet({ contactId, name, onClose }: { contactId: string; name?: string; onClose: () => void }) {
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function write(force: boolean) {
    setAiError(null);
    start(async () => {
      const result = await writeBriefFor(contactId, force);
      if ("error" in result) {
        start(() => setAiError(result.error));
        return;
      }
      start(() => setView((prev) => (prev ? { ...prev, writing: result.writing } : prev)));
    });
  }

  useEffect(() => {
    let live = true;
    openBrief(contactId).then((result) => {
      if (!live) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setView(result);
      // Opening it is the tap: write it now unless one is kept for these
      // facts.
      if (result.ai && !result.writing) write(false);
    });
    return () => {
      live = false;
    };
    // write is stable enough: it only reads contactId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const who = view?.name ?? name ?? "";
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Brief${who ? `: ${who}` : ""}`}
      eyebrow="Before you call"
      testId="brief-sheet"
      footer={
        <div className="flex items-center justify-end gap-2">
          {view?.ai && view.writing && (
            <button type="button" onClick={() => write(true)} disabled={pending} className="btn btn-ghost min-h-11" data-testid="brief-rewrite">
              <IconSparkles size={13} />
              {pending ? "Writing…" : "Rewrite"}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-primary min-h-11" data-testid="brief-close">
            Done
          </button>
        </div>
      }
    >
      {error && (
        <p className="text-sm text-[var(--danger)]" data-testid="brief-error">
          {error}
        </p>
      )}
      {!view && !error && <p className="faint text-sm">Reading what&apos;s on file…</p>}
      {view && (
        <div className="space-y-4">
          {view.ai && (
            <section aria-label="The brief" data-testid="brief-ai" data-state={view.writing ? "written" : pending ? "writing" : "none"}>
              {view.writing ? (
                <>
                  <ul className="space-y-1.5 text-sm" data-testid="brief-lines">
                    {view.writing.lines.map((line, index) => (
                      <li key={index} className="flex gap-2">
                        <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-dim)]" />
                        <span className="min-w-0">{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 rounded-lg bg-[var(--tint-2)] px-3 py-2 text-sm" data-testid="brief-ask">
                    <span className="font-semibold">Ask: </span>
                    {view.writing.ask}
                  </p>
                  <p className="faint mt-1 text-[0.7rem]">Written by AI from the facts below only.</p>
                </>
              ) : pending ? (
                <p className="faint text-sm" data-testid="brief-writing">
                  Writing the brief…
                </p>
              ) : null}
              {aiError && (
                <p className="text-sm text-[var(--warn)]" data-testid="brief-ai-error">
                  {aiError === "Couldn't write the brief this time." ? aiError : `Couldn't write the brief this time. ${aiError}`}
                </p>
              )}
            </section>
          )}
          <section aria-label="On file" className={view.ai ? "border-t border-[var(--hairline-3)] pt-3" : ""}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">On file</h3>
            <ul className="space-y-1 text-sm" data-testid="brief-facts">
              {view.lines.map((line) => (
                <li key={line.key} className="[overflow-wrap:anywhere]" data-fact={line.key}>
                  {line.text}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Sheet>
  );
}
