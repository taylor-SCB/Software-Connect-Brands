import Link from "next/link";
import { EmptyState } from "@/components/ui";
import {
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconTrending,
} from "@/components/icons";
import { ACTIVITY_LABELS, DEAL_STAGE_COLORS, DEAL_STAGE_LABELS, type ActivityTypeValue, type DealStageValue } from "@/lib/constants";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
  OPPORTUNITY_CREATED: IconTrending,
  DEAL_CREATED: IconTrending,
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
  via?: { id: string; name: string } | null;
  // On a company page: logged on the company with nobody linked, by this
  // teammate, who ticked "I'm choosing not to link a contact". Reads
  // "Nic Steffl Bypassed" where the person's name would be, until the
  // entry is claimed for someone under Other Contacts.
  bypassedBy?: string | null;
  // "Opportunity Created" / "Deal Created": the person's role on it now,
  // and for a deal its stage now.
  special?: { role: "PRIMARY" | "ASSOCIATED"; stage: string | null } | null;
};

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
    <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
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
                      style={{ color: DEAL_STAGE_COLORS[stage], borderColor: `color-mix(in srgb, ${DEAL_STAGE_COLORS[stage]} 45%, transparent)` }}
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
        return (
          <li key={activity.id} className="flex gap-3 px-5 py-3">
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
              <p className="text-sm leading-relaxed">{activity.body}</p>
              <p className="faint mt-1 text-[0.7rem]">
                {ACTIVITY_LABELS[activity.type as ActivityTypeValue]} · {activity.userName} ·{" "}
                {activity.when}
                {activity.via && (
                  <>
                    {" · "}
                    <Link href={`/dashboard/contacts/${activity.via.id}`} className="link">
                      {activity.via.name}
                    </Link>
                  </>
                )}
                {!activity.via && activity.bypassedBy && (
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}
