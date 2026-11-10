"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconCopy, IconSparkles, IconX } from "@/components/icons";
import { leadLabelStyle } from "@/lib/lead-labels";
import { formatCents } from "@/lib/format";
import { draftFollowUp, logFollowUpSent, suggestFromMeeting, suggestLeadLabel, type FollowUpDraft, type MeetingSuggestions } from "./ai-actions";

// The Pipeline's gone-quiet badge and AI helpers (Nov 10, 2026). Every AI
// answer here is shown to edit, copy or accept; nothing is saved by the
// AI itself.

export function QuietBadge({ days }: { days: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-[rgb(251_191_36/0.45)] bg-[rgb(251_191_36/0.12)] px-1.5 py-px text-[0.62rem] font-semibold text-[var(--warn)]"
      title="Nobody has logged a call, text, email or meeting with anyone on it lately"
      data-testid="quiet-badge"
      data-days={days}
    >
      Quiet {days} {days === 1 ? "day" : "days"}
    </span>
  );
}

// "Draft a follow-up" and the dialog it opens.
export function FollowUpButton({ opportunityId, compact = false }: { opportunityId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact ? "link inline-flex items-center gap-1 text-[0.7rem]" : "btn btn-ghost btn-sm"}
        data-testid="follow-up-draft"
      >
        <IconSparkles size={compact ? 11 : 13} />
        Draft a follow-up
      </button>
      {open && <FollowUpDialog opportunityId={opportunityId} onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowUpDialog({ opportunityId, onClose }: { opportunityId: string; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<FollowUpDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    draftFollowUp(opportunityId).then((result) => {
      if (!live) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setDraft(result);
      setText(result.text);
      setSubject(result.subject);
      setBody(result.body);
    });
    return () => {
      live = false;
    };
  }, [opportunityId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${what} copied`);
    } catch {
      setNotice("Couldn't reach the clipboard. Select the words and copy them.");
    }
  }

  function logSent(type: "EMAIL" | "TEXT") {
    if (!draft) return;
    setNotice(null);
    start(async () => {
      const result = await logFollowUpSent({
        id: opportunityId,
        contactId: draft.to.contactId,
        type,
        body: type === "EMAIL" ? `${subject.trim()}\n\n${body.trim()}`.trim() : text.trim(),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setNotice(result.success ?? "Logged");
      router.refresh();
    });
  }

  return createPortal(
    <div
      className="modal-backdrop"
      style={{ zIndex: 80 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Follow-up draft" className="card card-lit popover max-h-[92vh] w-full max-w-lg overflow-y-auto p-5" data-testid="follow-up-dialog">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow mb-1">Drafted by AI · edit before you send</p>
            <h2 className="text-base font-semibold">{draft ? `Follow up with ${draft.to.name}` : "Drafting a follow-up…"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm !px-1.5" data-testid="follow-up-close">
            <IconX size={14} />
          </button>
        </div>
        {!draft && !error && <p className="faint text-sm">Reading the latest meeting notes…</p>}
        {error && (
          <p className="mb-2 text-sm text-[var(--danger)]" data-testid="follow-up-error">
            {error}
          </p>
        )}
        {draft && (
          <div className="space-y-4">
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Text message{draft.to.phone ? ` · ${draft.to.phone}` : ""}</h3>
                <button type="button" onClick={() => copy(text, "Text")} className="link inline-flex items-center gap-1 text-xs" data-testid="follow-up-copy-text">
                  <IconCopy size={12} />
                  Copy
                </button>
              </div>
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} className="input text-sm" data-testid="follow-up-text" />
              <button type="button" onClick={() => logSent("TEXT")} disabled={pending || !text.trim()} className="btn btn-ghost btn-sm mt-1" data-testid="follow-up-log-text">
                Log text as sent
              </button>
            </section>
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Email{draft.to.email ? ` · ${draft.to.email}` : ""}</h3>
                <button
                  type="button"
                  onClick={() => copy(`${subject}\n\n${body}`, "Email")}
                  className="link inline-flex items-center gap-1 text-xs"
                  data-testid="follow-up-copy-email"
                >
                  <IconCopy size={12} />
                  Copy
                </button>
              </div>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Subject" className="input input-sm mb-1.5" data-testid="follow-up-subject" />
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} aria-label="Email body" className="input text-sm" data-testid="follow-up-body" />
              <button type="button" onClick={() => logSent("EMAIL")} disabled={pending || !body.trim()} className="btn btn-ghost btn-sm mt-1" data-testid="follow-up-log-email">
                Log email as sent
              </button>
            </section>
            <p className="faint text-[0.7rem]">
              Send it from your own phone or email. &ldquo;Log as sent&rdquo; puts it on {draft.to.name}&apos;s history and the calendar as a touch.
            </p>
          </div>
        )}
        {notice && (
          <p className="mt-3 text-xs text-[var(--ok)]" role="status" data-testid="follow-up-notice">
            {notice}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

// The faint suggested label on a tile or panel with none: the rules' pick
// when they have one, else (with AI on) a "Suggest label" link that asks.
// Clicking the chip accepts it; the × dismisses it for this view.
export function SuggestedLabel({
  opportunityId,
  rule,
  ai,
  onAccept,
}: {
  opportunityId: string;
  rule: { label: string; reason: string } | null;
  ai: boolean;
  onAccept: (label: string) => void;
}) {
  const [asked, setAsked] = useState<{ label: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pending, start] = useTransition();
  const shown = rule ?? asked;
  if (dismissed) return null;
  if (shown) {
    const style = leadLabelStyle(shown.label);
    return (
      <span className="inline-flex items-center gap-0.5" data-testid="suggested-label" data-label={shown.label}>
        <button
          type="button"
          onClick={() => onAccept(shown.label)}
          title={`Suggested: ${shown.reason}. Click to use it.`}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-1.5 py-px text-[0.62rem] font-semibold opacity-60 hover:opacity-100"
          style={{ borderColor: style.borderColor, color: style.background === "transparent" ? style.color : style.background }}
          data-testid="suggested-label-accept"
        >
          {shown.label}?
        </button>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss the suggestion" className="faint hover:text-[var(--text)]" data-testid="suggested-label-dismiss">
          <IconX size={10} />
        </button>
      </span>
    );
  }
  if (!ai) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await suggestLeadLabel(opportunityId);
            if ("error" in result) setError(result.error);
            else setAsked(result);
          })
        }
        className="faint inline-flex items-center gap-0.5 text-[0.62rem] hover:text-[var(--text)]"
        data-testid="suggest-label"
      >
        <IconSparkles size={10} />
        {pending ? "Thinking…" : "Suggest label"}
      </button>
      {error && (
        <span className="text-[0.62rem] text-[var(--danger)]" data-testid="suggest-label-error">
          {error}
        </span>
      )}
    </span>
  );
}

// "Suggest from meeting notes" in the opportunity panel: chips to accept
// into the panel's own form (Primary POC, Lead Label, Value) or dismiss.
// Nothing is saved until the panel's Save.
export function MeetingSuggest({
  opportunityId,
  canSetValue,
  onPrimary,
  onLabel,
  onValue,
}: {
  opportunityId: string;
  // The panel has a value box (a deal with no quotes yet).
  canSetValue: boolean;
  onPrimary: (contactId: string) => void;
  onLabel: (label: string) => void;
  onValue: (cents: number) => void;
}) {
  const [result, setResult] = useState<MeetingSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const hide = (key: string) => setGone((list) => [...list, key]);

  function ask() {
    setError(null);
    start(async () => {
      const answer = await suggestFromMeeting(opportunityId);
      if ("error" in answer) {
        setError(answer.error);
        setResult(null);
        return;
      }
      setGone([]);
      setResult(answer);
    });
  }

  const chips: { key: string; title: string; detail: string; accept?: () => void; note?: string }[] = [];
  if (result?.primary) {
    const primary = result.primary;
    chips.push({ key: "primary", title: `Primary POC: ${primary.name}`, detail: primary.reason, accept: () => onPrimary(primary.contactId) });
  }
  if (result?.leadLabel) {
    const label = result.leadLabel;
    chips.push({ key: "label", title: `Lead Label: ${label.label}`, detail: label.reason, accept: () => onLabel(label.label) });
  }
  if (result?.value) {
    const value = result.value;
    chips.push({
      key: "value",
      title: `Estimated value: ${formatCents(value.cents)}`,
      detail: value.reason,
      accept: canSetValue ? () => onValue(value.cents) : undefined,
      note: canSetValue ? undefined : "Use it when you convert this to a deal.",
    });
  }
  const shown = chips.filter((chip) => !gone.includes(chip.key));
  const nextStep = result?.nextStep && !gone.includes("next") ? result.nextStep : null;

  return (
    <section data-testid="meeting-suggest">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">From the meeting notes</h3>
        <button type="button" onClick={ask} disabled={pending} className="btn btn-ghost btn-sm" data-testid="meeting-suggest-ask">
          <IconSparkles size={12} />
          {pending ? "Reading the notes…" : result ? "Ask again" : "Suggest from meeting notes"}
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-[var(--danger)]" data-testid="meeting-suggest-error">
          {error}
        </p>
      )}
      {result && shown.length === 0 && !nextStep && <p className="faint mt-1 text-xs">Nothing left to suggest.</p>}
      {(shown.length > 0 || nextStep) && (
        <ul className="mt-2 space-y-1.5">
          {shown.map((chip) => (
            <li
              key={chip.key}
              className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-xs"
              data-testid="meeting-chip"
              data-kind={chip.key}
            >
              <span className="min-w-0">
                <span className="font-medium">{chip.title}</span>
                <span className="faint block text-[0.68rem]">{chip.note ?? chip.detail}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {chip.accept && (
                  <button
                    type="button"
                    onClick={() => {
                      chip.accept!();
                      hide(chip.key);
                    }}
                    className="btn btn-primary btn-sm !py-0.5"
                    data-testid="meeting-chip-accept"
                  >
                    Use
                  </button>
                )}
                <button type="button" onClick={() => hide(chip.key)} aria-label="Dismiss" className="btn btn-ghost btn-sm !px-1" data-testid="meeting-chip-dismiss">
                  <IconX size={11} />
                </button>
              </span>
            </li>
          ))}
          {nextStep && (
            <li className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-xs" data-testid="meeting-chip" data-kind="next">
              <span className="min-w-0">
                <span className="font-medium">Next step</span>
                <span className="faint block text-[0.68rem]" data-testid="meeting-next-step">{nextStep}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(nextStep).then(() => setCopied(true), () => setCopied(false));
                  }}
                  className="btn btn-ghost btn-sm !py-0.5"
                >
                  <IconCopy size={11} />
                  {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={() => hide("next")} aria-label="Dismiss" className="btn btn-ghost btn-sm !px-1" data-testid="meeting-chip-dismiss">
                  <IconX size={11} />
                </button>
              </span>
            </li>
          )}
          {(shown.length > 0 || nextStep) && (
            <li className="flex justify-end">
              <button type="button" onClick={() => setGone(["primary", "label", "value", "next"])} className="link text-[0.7rem]" data-testid="meeting-dismiss-all">
                Dismiss all
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
