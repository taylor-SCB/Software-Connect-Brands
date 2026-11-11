"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { MeterActionKey } from "@/lib/health";
import { FloatingMenu } from "@/components/floating-menu";
import { IconChevronDown, IconCopy, IconMessage, IconPhone } from "@/components/icons";
import type { ContactMeeting } from "./contact-data";
import { useContactPage } from "./contact-shell";
import { EarlyConfirm, MoveButton, useMeetingActions } from "./meeting-actions";

export type PhoneRow = { label: string; number: string; key: "mobile" | "phone" | "phone2" };

// What the one main button needs to act on, worked out on the server.
export type MainActionData = {
  action: { key: MeterActionKey; label: string } | null;
  // The meeting to mark (due) or show (next).
  meeting: ContactMeeting | null;
  // A quote made and not sent; the latest one out for an answer.
  draftQuoteId: string | null;
  sentQuoteId: string | null;
  // /c/<token> of the latest contract out for signature.
  signingPath: string | null;
  // Where the deposit is invoiced from: the signed contract's page.
  depositHref: string | null;
};

const PRIMARY = "btn btn-primary pointer-coarse:min-h-11";
const GHOST = "btn btn-ghost btn-sm pointer-coarse:min-h-11";

// The one filled button that follows the stage (BDR redesign): Call →
// Book meeting → "Meeting Tue 10:00 AM" with Reschedule → Mark held (with
// No-show) → Start a quote / Send quote → Customer said yes → Copy signing
// link → Send deposit invoice. Nothing for Won with nothing owed, or a
// closed record. `variant="bar"` is the phone's bottom bar: the button
// alone, short words.
export function MainAction({ data, phones, variant = "header" }: { data: MainActionData; phones: PhoneRow[]; variant?: "header" | "bar" }) {
  const page = useContactPage();
  const meeting = useMeetingActions(data.meeting);
  const [copied, setCopied] = useState(false);
  const action = data.action;
  if (!action) return null;
  const bar = variant === "bar";
  const testId = bar ? "phone-bar-main" : "contact-main";
  const cls = bar ? "btn btn-primary btn-sm min-h-11 w-full px-2" : `${PRIMARY} max-sm:w-full max-sm:min-h-12!`;

  switch (action.key) {
    case "call": {
      const first = phones[0];
      if (!first)
        return (
          <button type="button" className={cls} onClick={page.openLog} data-testid={testId} data-action="call">
            <IconPhone size={14} />
            Call
          </button>
        );
      return (
        <a href={`tel:${first.number}`} className={cls} onClick={page.armReturn} data-testid={testId} data-action="call">
          <IconPhone size={14} />
          Call
        </a>
      );
    }
    case "book":
      return (
        <button type="button" className={cls} onClick={page.openBook} data-testid={testId} data-action="book">
          {bar ? "Book" : "Book meeting"}
        </button>
      );
    case "meeting":
      return (
        <span className={bar ? "contents" : "inline-flex flex-wrap items-center gap-2 max-sm:w-full"}>
          <span className={`${cls} cursor-default`} role="note" data-testid={testId} data-action="meeting">
            {bar ? (data.meeting?.when ?? action.label) : action.label}
          </span>
          {!bar && data.meeting && (data.meeting.meetingId || data.meeting.eventId) && (
            <MoveButton
              label="Reschedule"
              testId="contact-reschedule"
              pending={meeting.pending}
              withTime={Boolean(data.meeting.meetingId)}
              onMove={(on, time, close) => meeting.move(on, time, close)}
            />
          )}
          {!bar && meeting.error && <span className="basis-full text-xs text-[var(--danger)]">{meeting.error}</span>}
        </span>
      );
    case "mark-held":
      return (
        <span className={bar ? "contents" : "inline-flex flex-wrap items-center gap-2 max-sm:w-full"}>
          <button type="button" className={cls} disabled={meeting.pending} onClick={() => meeting.held()} data-testid={testId} data-action="mark-held">
            {meeting.pending ? "Saving…" : "Mark held"}
          </button>
          {!bar && meeting.canMark && (
            <button type="button" className={GHOST} disabled={meeting.pending} onClick={meeting.noShow} data-testid="contact-no-show">
              No-show
            </button>
          )}
          {!bar && meeting.confirm && (
            <EarlyConfirm text={meeting.confirm} pending={meeting.pending} onYes={() => meeting.held(true)} onNo={meeting.cancelConfirm} />
          )}
          {!bar && meeting.error && !meeting.confirm && <span className="basis-full text-xs text-[var(--danger)]">{meeting.error}</span>}
        </span>
      );
    case "start-quote":
      return data.draftQuoteId ? (
        <Link href={`/dashboard/quotes/${data.draftQuoteId}`} className={cls} data-testid={testId} data-action="send-quote">
          Send quote
        </Link>
      ) : (
        <Link href={`/dashboard/quotes/new?contactId=${page.contactId}`} className={cls} data-testid={testId} data-action="start-quote">
          {bar ? "Quote" : "Start a quote"}
        </Link>
      );
    case "quote-yes":
      if (!data.sentQuoteId && data.draftQuoteId)
        return (
          <Link href={`/dashboard/quotes/${data.draftQuoteId}`} className={cls} data-testid={testId} data-action="send-quote">
            Send quote
          </Link>
        );
      return (
        <Link
          href={data.sentQuoteId ? `/dashboard/quotes/${data.sentQuoteId}` : `/dashboard/quotes/new?contactId=${page.contactId}`}
          className={cls}
          data-testid={testId}
          data-action="quote-yes"
        >
          {bar ? "Said yes" : "Customer said yes"}
        </Link>
      );
    case "signing-link":
      if (!data.signingPath)
        return (
          <Link href={`/dashboard/contracts/new?contactId=${page.contactId}`} className={cls} data-testid={testId} data-action="signing-link">
            New contract
          </Link>
        );
      return (
        <button
          type="button"
          className={cls}
          data-testid={testId}
          data-action="signing-link"
          onClick={async () => {
            const url = `${window.location.origin}${data.signingPath}`;
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              window.prompt("Copy the signing link", url);
            }
          }}
        >
          <IconCopy size={13} />
          {copied ? "Copied" : bar ? "Signing link" : "Copy signing link"}
        </button>
      );
    case "deposit":
      return (
        <Link href={data.depositHref ?? `/dashboard/contacts/${page.contactId}#paperwork`} className={cls} data-testid={testId} data-action="deposit">
          {bar ? "Deposit" : "Send deposit invoice"}
        </Link>
      );
    default:
      return null;
  }
}

// Call ▾: the best number (mobile first) in one tap, the others in the
// menu. Coming back to the page opens "What happened with …?".
export function CallButton({ phones, variant = "header" }: { phones: PhoneRow[]; variant?: "header" | "bar" }) {
  const page = useContactPage();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const bar = variant === "bar";
  const testId = bar ? "phone-bar-call" : "contact-call";
  if (phones.length === 0) {
    return (
      <Link
        href={`/dashboard/contacts/${page.contactId}/edit`}
        className={bar ? "btn btn-ghost btn-sm min-h-11 w-full flex-col gap-0.5 px-1 text-[0.7rem]" : GHOST}
        title="No number on file · Add one"
        data-testid={testId}
      >
        <IconPhone size={13} />
        {bar ? "Call" : "No number · Add one"}
      </Link>
    );
  }
  if (bar) {
    return (
      <a href={`tel:${phones[0].number}`} onClick={page.armReturn} className="btn btn-ghost btn-sm min-h-11 w-full flex-col gap-0.5 px-1 text-[0.7rem]" data-testid={testId}>
        <IconPhone size={14} />
        Call
      </a>
    );
  }
  return (
    <span className="inline-flex">
      <a
        href={`tel:${phones[0].number}`}
        onClick={page.armReturn}
        className={`${GHOST} ${phones.length > 1 ? "rounded-r-none" : ""}`}
        title={`Call ${phones[0].label.toLowerCase()} ${phones[0].number}`}
        data-testid={testId}
      >
        <IconPhone size={13} />
        Call
      </a>
      {phones.length > 1 && (
        <>
          <button
            ref={anchor}
            type="button"
            className={`${GHOST} -ml-px rounded-l-none px-1.5`}
            aria-label="Pick a number to call"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            data-testid="contact-call-more"
          >
            <IconChevronDown size={12} />
          </button>
          <FloatingMenu anchor={anchor} open={open} onClose={() => setOpen(false)} width={240} label="Call" testId="contact-call-menu">
            <div className="py-1">
              {phones.map((row) => (
                <a
                  key={row.key}
                  href={`tel:${row.number}`}

                  onClick={() => {
                    setOpen(false);
                    page.armReturn();
                  }}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-[var(--hover)] pointer-coarse:min-h-11"
                  data-testid={`contact-call-${row.key}`}
                >
                  <span className="faint text-xs">{row.label}</span>
                  <span className="num">{row.number}</span>
                </a>
              ))}
            </div>
          </FloatingMenu>
        </>
      )}
    </span>
  );
}

// Text: the mobile first (a desk line can't take one), else the phone.
export function TextButton({ phones, variant = "header" }: { phones: PhoneRow[]; variant?: "header" | "bar" }) {
  const page = useContactPage();
  const bar = variant === "bar";
  const target = phones.find((row) => row.key === "mobile") ?? phones[0];
  const cls = bar ? "btn btn-ghost btn-sm min-h-11 w-full flex-col gap-0.5 px-1 text-[0.7rem]" : GHOST;
  if (!target) {
    // No number to text: the bar's slot says where to add one.
    if (bar)
      return (
        <Link href={`/dashboard/contacts/${page.contactId}/edit`} className={cls} title="No mobile on file · Add one" data-testid="phone-bar-text">
          <IconMessage size={14} />
          Text
        </Link>
      );
    return null;
  }
  return (
    <a href={`sms:${target.number}`} onClick={page.armReturn} className={cls} title={`Text ${target.number}`} data-testid={bar ? "phone-bar-text" : "contact-text"}>
      <IconMessage size={bar ? 14 : 13} />
      Text
    </a>
  );
}
