import { Card, CardHeader } from "@/components/ui";
import {
  IconNote,
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconClock,
  IconTrending,
  IconFileText,
  IconTag,
} from "@/components/icons";
import { formatCents, formatDate, daysSince as daysSinceDate } from "@/lib/format";
import { type ActivityTypeValue } from "@/lib/constants";

// The one place on a contact or company page that answers "how much have
// we talked, and when did we last talk?" at a glance.
export function ActivityOverview({
  notes,
  personalNotes,
  activity,
  lastTouchAt,
  openDealCents,
  openDealCount,
  quotesOut,
  timeZone,
}: {
  notes: number;
  personalNotes?: number;
  activity: Record<ActivityTypeValue, number>;
  lastTouchAt: Date | null;
  openDealCents: number;
  openDealCount: number;
  quotesOut: number;
  timeZone: string;
}) {
  const touches = activity.TEXT + activity.EMAIL + activity.PHONE_CALL + activity.MEETING;
  const daysSince = lastTouchAt ? daysSinceDate(lastTouchAt) : null;

  const tiles: { label: string; value: number; Icon: typeof IconNote; href: string }[] = [
    { label: "Calls", value: activity.PHONE_CALL, Icon: IconPhone, href: "#activity" },
    { label: "Texts", value: activity.TEXT, Icon: IconMessage, href: "#activity" },
    { label: "Emails", value: activity.EMAIL, Icon: IconMail, href: "#activity" },
    { label: "Meetings", value: activity.MEETING, Icon: IconCalendar, href: "#activity" },
    { label: "Notes", value: notes, Icon: IconNote, href: "#notes" },
    { label: "Personal", value: personalNotes ?? 0, Icon: IconTag, href: "#notes" },
  ];

  return (
    <Card lit>
      <CardHeader
        title="Activity overview"
        subtitle={touches === 0 ? "No touches yet" : `${touches} ${touches === 1 ? "touch" : "touches"} logged`}
      />
      <div className="grid grid-cols-3 gap-2 p-4">
        {tiles.map(({ label, value, Icon, href }) => (
          <a
            key={label}
            href={href}
            className="card card-hover flex flex-col items-center gap-1 px-2 py-3 text-center"
          >
            <Icon
              size={14}
              className={value > 0 ? "text-[var(--brand)]" : "text-[var(--text-faint)]"}
            />
            <span className={`num text-lg font-semibold leading-none ${value > 0 ? "" : "faint"}`}>
              {value}
            </span>
            <span className="faint text-[0.66rem]">{label}</span>
          </a>
        ))}
      </div>
      <div className="divider" />
      <dl className="space-y-3 px-5 py-4 text-sm">
        <OverviewRow
          Icon={IconClock}
          label="Last touch"
          value={
            lastTouchAt ? (
              <>
                <span className="font-medium">
                  {daysSince === 0
                    ? "Today"
                    : daysSince === 1
                      ? "Yesterday"
                      : `${daysSince} days ago`}
                </span>
                <span className="faint"> · {formatDate(lastTouchAt, timeZone)}</span>
              </>
            ) : (
              <span className="faint">Never</span>
            )
          }
          warn={daysSince !== null && daysSince >= 8}
        />
        <OverviewRow
          Icon={IconTrending}
          label="Open pipeline"
          value={
            openDealCount > 0 ? (
              <>
                <span className="num font-medium">{formatCents(openDealCents)}</span>
                <span className="faint">
                  {" "}
                  · {openDealCount} {openDealCount === 1 ? "deal" : "deals"}
                </span>
              </>
            ) : (
              <span className="faint">Nothing open</span>
            )
          }
        />
        <OverviewRow
          Icon={IconFileText}
          label="Quotes out"
          value={
            quotesOut > 0 ? (
              <span className="num font-medium">{quotesOut}</span>
            ) : (
              <span className="faint">None waiting</span>
            )
          }
        />
      </dl>
    </Card>
  );
}

function OverviewRow({
  Icon,
  label,
  value,
  warn = false,
}: {
  Icon: typeof IconClock;
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="faint flex items-center gap-1.5 text-xs">
        <Icon size={12} className={warn ? "text-[#fbbf24]" : undefined} />
        {label}
      </dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}
