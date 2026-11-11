import { ink } from "@/lib/ink";
import { Fragment } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import {
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconTrending,
  IconFileText,
  IconSignature,
  IconCheck,
} from "@/components/icons";
import { MarketingBadge } from "@/components/crm-cells";
import { ActivityDelete } from "@/components/activity-delete";
import {
  ACTIVITY_LABELS,
  ACTIVITY_OUTCOME_LABELS,
  DEAL_STAGE_COLORS,
  DEAL_STAGE_LABELS,
  type ActivityOutcomeValue,
  type ActivityTypeValue,
  type DealStageValue,
} from "@/lib/constants";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
  OPPORTUNITY_CREATED: IconTrending,
  DEAL_CREATED: IconTrending,
  QUOTE_SENT: IconFileText,
  QUOTE_ACCEPTED: IconCheck,
  CONTRACT_SENT: IconSignature,
  SIGNED: IconSignature,
} as const;

// The two special lines an opportunity writes (Oct 27, 2026).
const SPECIAL_LABELS: Record<string, string> = {
  OPPORTUNITY_CREATED: "Opportunity Created",
  DEAL_CREATED: "Deal Created",
};

export type ActivityItem = {
  id: string;
  type: string;
  body: string;
  userName: string;
  when: string;
  others: number;
  // Who it was with, on a company page. Several people when one touch was
  // logged on them at once: the company page shows that batch as one line
  // naming each of them (Nov 10, 2026).
  via?: { id: string; name: string } | { id: string; name: string }[] | null;
  // On a company page: logged on the company with nobody linked, by this
  // teammate, who ticked "I'm choosing not to link a contact". Reads
  // "Nic Steffl Bypassed" where the person's name would be, until the
  // entry is claimed for someone under Other Contacts.
  bypassedBy?: string | null;
  // "Opportunity Created" / "Deal Created": the person's role on it now,
  // and for a deal its stage now.
  special?: { role: "PRIMARY" | "ASSOCIATED"; stage: string | null } | null;
  // An email marketing send (Nov 10, 2026): on the log, never a touch.
  marketing?: boolean;
  // How it went (BDR redesign, Nov 11, 2026). A connect (Talked, They
  // replied, Held — or an old meeting, which counts as met) gets a tag in
  // the health colour; an attempt reads muted with its outcome in words.
  // Both optional: a feed that passes neither looks as it did.
  outcome?: string | null;
  connect?: boolean;
  // Quote sent / Contract sent / Signed, read from the paperwork's own
  // dates: on the history, never a touch. `label` overrides the words, for
  // a line that names someone ("Accepted by Dana Ruiz").
  paper?: { href: string; doc: string; label?: string } | null;
  // Your own line (or any, for an Owner or Admin): Delete takes back the
  // save it came from.
  undoBatchId?: string | null;
};

// "● Talked" in the health colour, the word in text colour.
function ConnectTag({ outcome }: { outcome: string | null | undefined }) {
  const words = outcome ? (ACTIVITY_OUTCOME_LABELS[outcome as ActivityOutcomeValue] ?? outcome) : "Met";
  return (
    <span className="health-word mr-1.5 align-middle" data-health="good" data-testid="activity-connect">
      <span className="health-word-mark" aria-hidden="true">
        ●
      </span>
      {words}
    </span>
  );
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        body="Log a call, text, email or meeting to build the history."
      />
    );
  }
  return (
    <ul className="divide-y divide-[var(--hairline)]">
      {items.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.type as keyof typeof ACTIVITY_ICONS] ?? IconCalendar;
        if (activity.special) {
          const stage = activity.special.stage as DealStageValue | null;
          return (
            <li key={activity.id} className="flex gap-3 px-5 py-3" data-testid="activity-special" data-kind={activity.type}>
              <div
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "color-mix(in srgb, var(--accent-2, var(--brand)) 18%, transparent)", color: "var(--brand)" }}
              >
                <Icon size={14} />
              </div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm leading-relaxed">
                  <span className="font-semibold">{SPECIAL_LABELS[activity.type]}</span>
                  <span className="faint">·</span>
                  <span className="truncate">{activity.body}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
                  <span className="badge border-[var(--border-strong)] text-[0.62rem]" data-testid="activity-role">
                    {activity.special.role === "PRIMARY" ? "Primary" : "Associated"}
                  </span>
                  {stage && (
                    <span
                      className="badge text-[0.62rem]"
                      style={{ color: ink(DEAL_STAGE_COLORS[stage]), borderColor: `color-mix(in srgb, ${DEAL_STAGE_COLORS[stage]} 45%, transparent)` }}
                      data-testid="activity-stage"
                    >
                      {DEAL_STAGE_LABELS[stage]}
                    </span>
                  )}
                  <span className="faint">
                    {activity.userName ? `${activity.userName} · ` : ""}
                    {activity.when}
                  </span>
                </p>
              </div>
            </li>
          );
        }
        if (activity.paper) {
          return (
            <li key={activity.id} className="flex gap-3 px-5 py-3" data-testid="activity-paper" data-kind={activity.type}>
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--tint-2)] text-[var(--text-dim)]">
                <Icon size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-sm leading-relaxed">
                  <span className="font-semibold">
                    {activity.paper.label ?? (activity.type === "QUOTE_SENT" ? "Quote sent" : activity.type === "CONTRACT_SENT" ? "Contract sent" : "Signed")}
                  </span>
                  {" · "}
                  <Link href={activity.paper.href} className="link">
                    <span className="docnum">{activity.paper.doc}</span> {activity.body}
                  </Link>
                </p>
                <p className="faint mt-1 text-[0.7rem]">
                  {activity.userName ? `${activity.userName} · ` : ""}
                  {activity.when}
                </p>
              </div>
            </li>
          );
        }
        const via = activity.via ? [activity.via].flat() : [];
        // An attempt (no answer, voicemail, sent with no reply, a no-show,
        // or an old call with nothing recorded) reads muted once outcomes
        // are being shown; a connect gets its tag.
        const attempt = activity.connect === false;
        const outcomeWords = activity.outcome ? (ACTIVITY_OUTCOME_LABELS[activity.outcome as ActivityOutcomeValue] ?? activity.outcome) : null;
        // The chip's words become the note when none is typed: say them once.
        const sameWords = Boolean(outcomeWords) && activity.body.trim().toLowerCase().startsWith(outcomeWords!.toLowerCase());
        const attemptWords = attempt && !sameWords ? outcomeWords : null;
        const body = activity.connect && sameWords && activity.body.trim().length === outcomeWords!.length ? "" : activity.body;
        return (
          <li
            key={activity.id}
            className="flex gap-3 px-5 py-3"
            data-testid="activity-line"
            data-marketing={activity.marketing ? "1" : undefined}
            data-connect={activity.connect === undefined ? undefined : activity.connect ? "1" : "0"}
            data-outcome={activity.outcome ?? undefined}
          >
            <div
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "color-mix(in srgb, var(--brand) 14%, transparent)",
                color: "var(--brand)",
              }}
            >
              <Icon size={14} />
            </div>
            <div className="min-w-0">
              <p className={`text-sm leading-relaxed ${attempt ? "muted" : ""}`}>
                {activity.connect && <ConnectTag outcome={activity.outcome} />}
                {attemptWords && <span className="muted mr-1.5 text-xs font-medium" data-testid="activity-attempt">{attemptWords} ·</span>}
                {body}
              </p>
              <p className="faint mt-1 text-[0.7rem]">
                {ACTIVITY_LABELS[activity.type as ActivityTypeValue]}
                {activity.marketing && <MarketingBadge />} · {activity.userName} ·{" "}
                {activity.when}
                {via.map((person, index) => (
                  <Fragment key={person.id}>
                    {index === 0 ? " · " : ", "}
                    <Link href={`/dashboard/contacts/${person.id}`} className="link">
                      {person.name}
                    </Link>
                  </Fragment>
                ))}
                {via.length === 0 && activity.bypassedBy && (
                  <>
                    {" · "}
                    <span className="badge border-[var(--border)] text-[0.62rem] text-[var(--text-faint)]" data-testid="activity-bypassed">
                      {activity.bypassedBy} Bypassed
                    </span>
                  </>
                )}
                {activity.others > 0 &&
                  ` · also on ${activity.others} ${activity.others === 1 ? "other" : "others"}`}
              </p>
              {activity.undoBatchId && (
                <div className="mt-1">
                  <ActivityDelete batchId={activity.undoBatchId} others={activity.others} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
