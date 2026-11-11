import Link from "next/link";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { HealthDot } from "@/components/health-marks";
import { IconPhone, IconMessage } from "@/components/icons";
import { pulseCaption, type LeadHealth } from "@/lib/health";

// The cells the Contacts and Companies lists share (BDR redesign, Nov 11,
// 2026). No hooks: drawn by the server, with the meter's own client part.

// Pulse: the mini meter (length = how far along, colour = how warm, with
// the health dot) and "4 tries · 1 talk · 6d", plus who touched last when
// that isn't the record's rep — what the old Last Contacted By column said.
export function PulseCell({ health, repId }: { health: LeadHealth | undefined; repId: string | null }) {
  if (!health) return <span className="faint">—</span>;
  return (
    <div className="min-w-0" data-testid="pulse">
      <LifecycleMeter health={health} size="mini" showCaption={false} />
      <p className="faint mt-0.5 whitespace-nowrap text-xs" data-testid="pulse-caption">
        {pulseCaption(health, repId)}
      </p>
    </div>
  );
}

// Next step: "Meeting Tue 10:00 AM", red "Follow-up 4 days late", or
// nothing booked.
export function NextStepCell({ health }: { health: LeadHealth | undefined }) {
  if (!health) return <span className="faint">—</span>;
  if (health.reasonKey === "late")
    return (
      <span className="whitespace-nowrap text-xs font-medium text-[var(--danger)]" data-testid="next-step">
        {health.reason}
      </span>
    );
  if (health.nextText)
    return (
      <span className="whitespace-nowrap text-xs" data-testid="next-step">
        {health.nextText.charAt(0).toUpperCase() + health.nextText.slice(1)}
      </span>
    );
  return (
    <span className="faint whitespace-nowrap text-xs" data-testid="next-step">
      Nothing booked
    </span>
  );
}

// The number to call: mobile first, then phone, then phone 2.
export function bestPhone(contact: { mobile: string | null; phone: string | null; phone2: string | null }) {
  if (contact.mobile) return { number: contact.mobile, label: "Mobile" };
  if (contact.phone) return { number: contact.phone, label: "Phone" };
  if (contact.phone2) return { number: contact.phone2, label: "Phone 2" };
  return null;
}

// The other numbers, for the Phone 2 column.
export function otherPhones(contact: { mobile: string | null; phone: string | null; phone2: string | null }) {
  const best = bestPhone(contact)?.number;
  return [contact.phone, contact.phone2].filter((number): number is string => Boolean(number) && number !== best);
}

// The number to dial or text, without an extension: "(512) 555-0100 x204"
// is 5125550100, never 5125550100204 (audit fix, Nov 11, 2026). A call
// waits and then dials the extension (the comma); a text never carries it.
const EXTENSION = /\s*(?:x|ext\.?|extension)\s*(\d+)\s*$/i;
export function dialNumber(number: string) {
  const match = number.match(EXTENSION);
  const main = (match ? number.slice(0, match.index) : number).replace(/[^\d+]/g, "");
  return { main, extension: match?.[1] ?? null };
}
export function telHref(number: string) {
  const { main, extension } = dialNumber(number);
  return `tel:${main}${extension ? `,${extension}` : ""}`;
}
export function smsHref(number: string) {
  return `sms:${dialNumber(number).main}`;
}

// Tap to call. data-contact-id lets the list open "How did it go?" when the
// rep comes back from the call.
export function PhoneLink({ number, contactId, testId }: { number: string; contactId?: string; testId?: string }) {
  return (
    <a href={telHref(number)} className="num whitespace-nowrap hover:underline" data-contact-id={contactId} data-testid={testId}>
      {number}
    </a>
  );
}

// A phone card's 44px Call · Text · Log row. Log is passed in (a client
// button); a missing number leaves its button out rather than dead.
export function CardActions({ number, contactId, log }: { number: string | null; contactId?: string; log?: React.ReactNode }) {
  const button = "btn btn-ghost btn-sm min-h-[44px] flex-1 justify-center";
  return (
    <div className="mt-2 flex gap-2">
      {number && (
        <a href={telHref(number)} className={button} data-contact-id={contactId} data-testid="card-call">
          <IconPhone size={14} />
          Call
        </a>
      )}
      {number && contactId && (
        <a href={smsHref(number)} className={button} data-contact-id={contactId} data-testid="card-text">
          <IconMessage size={14} />
          Text
        </a>
      )}
      {log}
    </div>
  );
}

// "6d ago · 4 tries" under a phone card's meter.
export function cardCaption(health: LeadHealth | undefined) {
  if (!health) return "";
  const days = health.counts.lastTouchDays;
  const tries = health.counts.tries;
  // Never touched is "Not tried yet" only while nobody has tried them; a
  // person at Attempted or further by status (imported, set by hand) reads
  // as the desktop Pulse does (audit fix, Nov 11, 2026).
  if (days === null) return health.state === "NEW" ? "Not tried yet" : health.miniCaption;
  const when = days === 0 ? "Today" : `${days}d ago`;
  return tries > 0 ? `${when} · ${tries} ${tries === 1 ? "try" : "tries"}` : when;
}

// "3d · Marcus": the last touch and who made it.
export function lastTouchText(health: LeadHealth | undefined) {
  if (!health || health.counts.lastTouchDays === null) return null;
  const days = health.counts.lastTouchDays;
  const who = health.counts.lastTouchBy?.name?.trim().split(/\s+/)[0];
  return `${days === 0 ? "Today" : `${days}d`}${who ? ` · ${who}` : ""}`;
}

export function CardTitle({ href, name, health }: { href: string; name: string; health: LeadHealth | undefined }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link href={href} className="min-w-0 truncate text-base font-bold hover:underline">
        {name}
      </Link>
      {health && <HealthDot health={health} label={`Health: ${health.word}`} />}
    </div>
  );
}
