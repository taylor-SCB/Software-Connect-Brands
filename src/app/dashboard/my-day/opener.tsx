"use client";

import { useState, useTransition } from "react";
import { IconCopy, IconSparkles, IconX } from "@/components/icons";
import { draftOpener } from "../brief-actions";
import type { Opener } from "@/lib/brief";

// "Draft an opener" on an Up next row (AI release A, Nov 12, 2026; Taylor:
// this is the Call List, there is no separate page). Only on a tap, never
// for every row on load: one line to open the call and a short text, with
// Copy. The row's own Text button sends it from the phone and How did it
// go? logs it, as always; nothing here sends or saves a touch.

export function OpenerLink({ contactId, reason }: { contactId: string; reason: string }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<Opener | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function ask(force: boolean) {
    setError(null);
    setCopied(null);
    start(async () => {
      const result = await draftOpener(contactId, reason, force);
      start(() => {
        if ("error" in result) setError(result.error);
        else setOpener(result.opener);
      });
    });
  }

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${what} copied`);
    } catch {
      setCopied("Couldn't reach the clipboard. Select the words and copy them.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (open) return setOpen(false);
          setOpen(true);
          if (!opener) ask(false);
        }}
        aria-expanded={open}
        className="link inline-flex items-center gap-1 text-xs pointer-coarse:min-h-11"
        data-testid="up-next-opener"
      >
        <IconSparkles size={11} />
        {open ? "Hide opener" : "Draft an opener"}
      </button>
      {open && (
        <div className="mt-1.5 w-full min-w-0 rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-2 text-sm" data-testid="opener-card">
          {pending && !opener && <p className="faint text-xs">Drafting…</p>}
          {error && (
            <p className="text-xs text-[var(--danger)]" data-testid="opener-error">
              {error}
            </p>
          )}
          {opener && (
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--text-dim)]">Open the call with</span>
                  <button type="button" onClick={() => copy(opener.opener, "Opener")} className="link inline-flex items-center gap-1 text-xs pointer-coarse:min-h-11" data-testid="opener-copy-line">
                    <IconCopy size={11} />
                    Copy
                  </button>
                </div>
                <p className="[overflow-wrap:anywhere]" data-testid="opener-line">
                  {opener.opener}
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--text-dim)]">Or text</span>
                  <button type="button" onClick={() => copy(opener.text, "Text")} className="link inline-flex items-center gap-1 text-xs pointer-coarse:min-h-11" data-testid="opener-copy-text">
                    <IconCopy size={11} />
                    Copy
                  </button>
                </div>
                <p className="[overflow-wrap:anywhere]" data-testid="opener-text">
                  {opener.text}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="faint text-[0.7rem]">Drafted by AI from what&apos;s on file. Edit it as you say it.</span>
                <button type="button" onClick={() => ask(true)} disabled={pending} className="link text-xs pointer-coarse:min-h-11" data-testid="opener-rewrite">
                  {pending ? "Drafting…" : "Rewrite"}
                </button>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close the opener" className="faint pointer-coarse:min-h-11">
                  <IconX size={11} />
                </button>
              </div>
              {copied && (
                <p className="text-xs text-[var(--ok)]" role="status" data-testid="opener-copied">
                  {copied}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
