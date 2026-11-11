"use client";

import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { IconCheck, IconCopy, IconSend } from "@/components/icons";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { markQuoteSent } from "../actions";

// Whether the Line items card holds edits nobody has saved. Send quote
// sits under the DealJourney strip, away from the editor, and the
// customer's link prints only what is saved: pressing it with a line typed
// but not saved sent an empty $0.00 quote while the editor showed
// $2,100.00 (UX review, Nov 10, 2026).
const UnsavedLines = createContext<{ unsaved: boolean; setUnsaved: (unsaved: boolean) => void } | null>(null);

export function QuoteUnsavedProvider({ children }: { children: React.ReactNode }) {
  const [unsaved, setUnsaved] = useState(false);
  return <UnsavedLines.Provider value={{ unsaved, setUnsaved }}>{children}</UnsavedLines.Provider>;
}

// Called by the editor with its "Unsaved changes" flag.
export function useReportUnsavedLines(dirty: boolean) {
  const context = useContext(UnsavedLines);
  const setUnsaved = context?.setUnsaved;
  useEffect(() => {
    setUnsaved?.(dirty);
  }, [dirty, setUnsaved]);
}

export const UNSAVED_LINES_MESSAGE = "Save line items first. The customer's link shows only saved lines.";

type Way = "copy" | "text" | "email" | "mark";

// "Send quote" (BDR redesign, Release 8; was "Mark as sent", which sent
// nothing). Opens a share sheet — Copy link, Text, Email — and whichever
// is used marks the quote sent, which moves its deal to Quote Sent if it
// is behind (decision 19) and writes its calendar follow-ups. "Just mark
// it sent" is there for a quote that went out some other way. Nothing is
// emailed from the app: Text and Email open the phone's own messages and
// mail with the link written in. The server still refuses a quote with no
// saved lines, and the button waits while the editor has unsaved edits.
export function SendQuoteButton({
  quoteId,
  quoteLabel,
  publicPath,
  contact,
  className = "btn btn-primary btn-sm max-sm:w-full",
}: {
  quoteId: string;
  // "QUO-1001 Kitchen remodel"
  quoteLabel: string;
  publicPath: string;
  contact: { name: string; email: string | null; phone: string | null };
  className?: string;
}) {
  const unsaved = useContext(UnsavedLines)?.unsaved ?? false;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  // Pressed while lines were unsaved; the words go once they are saved.
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  if (typeof window !== "undefined" && origin === "") setOrigin(window.location.origin);

  const url = `${origin}${publicPath}`;
  const firstName = contact.name.split(/\s+/)[0] || contact.name;
  const message = `Hi ${firstName}, here is your quote ${quoteLabel}: ${url}`;
  const smsHref = `sms:${contact.phone ? contact.phone.replace(/[^\d+]/g, "") : ""}?&body=${encodeURIComponent(message)}`;
  const mailHref = `mailto:${contact.email ?? ""}?subject=${encodeURIComponent(`Your quote ${quoteLabel}`)}&body=${encodeURIComponent(`${message}\n`)}`;

  function send(way: Way) {
    setError(null);
    start(async () => {
      // The clipboard first, while the tap still counts as the person's
      // own (Safari refuses a write after a wait).
      if (way === "copy") {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        } catch {
          // Blocked in some embedded browsers; the link is on screen.
        }
      }
      const form = new FormData();
      form.set("quoteId", quoteId);
      const result = await markQuoteSent({}, form);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (way === "text") window.location.href = smsHref;
      if (way === "email") window.location.href = mailHref;
      setOpen(false);
    });
  }

  const shownBlock = blocked && unsaved ? UNSAVED_LINES_MESSAGE : null;

  return (
    <div className="flex flex-col items-end gap-1 max-sm:items-stretch">
      <button
        type="button"
        className={className}
        data-testid="send-quote"
        onClick={() => {
          if (unsaved) {
            // Nothing is sent: the edits stay in the editor to be saved.
            setBlocked(true);
            return;
          }
          setBlocked(false);
          setError(null);
          setCopied(false);
          setOpen(true);
        }}
      >
        <IconSend size={13} />
        Send quote
      </button>
      {shownBlock && (
        <p role="alert" className="max-w-xs text-right text-xs text-[var(--danger)]" data-testid="send-quote-error">
          {shownBlock}
        </p>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Send quote"
        title={quoteLabel}
        testId="send-quote-sheet"
        footer={
          <button
            type="button"
            className="btn btn-ghost w-full sm:w-auto"
            disabled={pending}
            onClick={() => send("mark")}
            data-testid="send-quote-mark"
          >
            Just mark it sent
          </button>
        }
      >
        <div className="space-y-4">
          <p className="muted text-sm">
            Pick how it goes to {contact.name}. Whichever you use marks the quote sent and puts its follow-up on the
            calendar.
          </p>
          <input
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="input input-sm num w-full text-xs"
            aria-label="Customer's link"
            data-testid="send-quote-link"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" className="btn btn-primary min-h-11 w-full" disabled={pending} onClick={() => send("copy")} data-testid="send-quote-copy">
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <button type="button" className="btn btn-ghost min-h-11 w-full" disabled={pending} onClick={() => send("text")} data-testid="send-quote-text">
              Text{contact.phone ? "" : "…"}
            </button>
            <button type="button" className="btn btn-ghost min-h-11 w-full" disabled={pending} onClick={() => send("email")} data-testid="send-quote-email">
              Email{contact.email ? "" : "…"}
            </button>
          </div>
          <p className="faint text-xs">
            {contact.phone || contact.email
              ? `Text and Email open your own messages and mail${contact.phone ? ` to ${contact.phone}` : ""}${contact.email ? `${contact.phone ? " and" : ""} ${contact.email}` : ""}, with the link written in.`
              : "No phone or email on file for them — Text and Email open blank, with the link written in."}
          </p>
          {pending && <p className="faint text-xs" role="status">Marking sent…</p>}
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]" data-testid="send-quote-error">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
