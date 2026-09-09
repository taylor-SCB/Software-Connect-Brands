import Link from "next/link";
import { EmptyState } from "@/components/ui";
import {
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
} from "@/components/icons";
import { ACTIVITY_LABELS, type ActivityTypeValue } from "@/lib/constants";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

export type ActivityItem = {
  id: string;
  type: string;
  body: string;
  userName: string;
  when: string;
  others: number;
  via?: { id: string; name: string } | null;
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
        const Icon = ACTIVITY_ICONS[activity.type as ActivityTypeValue];
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
