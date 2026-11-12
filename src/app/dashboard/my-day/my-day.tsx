import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Card, CardHeader } from "@/components/ui";
import { connectRate } from "@/lib/up-next";
import { REPORT_KEYS, REPORT_LABELS } from "@/lib/reports/common";
import type { TeamToday, RepCounts } from "@/lib/reports/daily";
import type { MyDay } from "./load";
import { Ring } from "./rings";
import { UpNextList } from "./up-next";
import { MeetingsCard } from "./meetings";
import { MemberJumpIn } from "./jump-in";
import { Greeting } from "./greeting";
import { RememberedDetails } from "./remembered-details";

// My day (BDR redesign, Nov 11, 2026; decision 9): a Member's first
// Overview tab. Top to bottom, and the same order on a phone: the greeting
// sentence, three week rings, Up next, Meetings, Done today (collapsed),
// Jump in, then "Team & money" and "Reports ▸" collapsed at the foot.
// An Owner or Admin opens a rep's from Team today, read-only.

function activityHref(repId: string) {
  return `/dashboard?report=activity&period=this-week&rep=${repId}`;
}

export function MyDayView({
  day,
  readOnly,
  teamMoney,
  ai = false,
  teamMoneyOpen = false,
}: {
  day: MyDay;
  readOnly: boolean;
  // AI is switched on: the greeting offers Rewrite, Up next rows offer a
  // drafted opener.
  ai?: boolean;
  // "Team & money" was left open last time (uiPrefs myday.teamMoney).
  teamMoneyOpen?: boolean;
  // The money tiles and Recent activity, rendered by the page.
  teamMoney: React.ReactNode;
}) {
  const { numbers, goals } = day;
  const rate = connectRate(numbers.week.tries, numbers.week.talks);
  return (
    <div className="space-y-5 pb-24 lg:pb-0" data-testid="my-day" data-rep={day.rep.id} data-readonly={readOnly ? "" : undefined}>
      <div>
        <p className="faint text-xs">{readOnly ? `${day.rep.name}'s day · read-only` : "My day"}</p>
        <Greeting text={day.greeting} ai={ai && !readOnly} />
      </div>

      <Card lit className="min-w-0">
        <CardHeader title={readOnly ? "Their week" : "My week"} subtitle={rate === null ? "Monday to today" : `Monday to today · ${rate}% of tries were talks`} />
        <div className="grid grid-cols-3 gap-2 px-3 py-4 sm:px-5" data-testid="week-rings">
          <Ring label="Tries" value={numbers.week.tries} goal={goals.tries} lastWeek={numbers.lastWeek.tries} href={activityHref(day.rep.id)} testId="ring-tries" />
          <Ring label="Talks" value={numbers.week.talks} goal={goals.talks} lastWeek={numbers.lastWeek.talks} href={activityHref(day.rep.id)} testId="ring-talks" />
          <Ring label="Meetings booked" value={numbers.week.booked} goal={goals.booked} lastWeek={numbers.lastWeek.booked} href={activityHref(day.rep.id)} testId="ring-booked" />
        </div>
      </Card>

      <Card lit className="min-w-0">
        <CardHeader title="Up next" subtitle={day.upNext.length ? `${day.upNext.length}${day.more ? "+" : ""} waiting, most urgent first` : undefined} />
        <UpNextList items={day.upNext} today={day.today} readOnly={readOnly} unowned={day.unowned} ai={ai} />
      </Card>

      <Card lit className="min-w-0">
        <CardHeader title="Meetings" subtitle="Today and the next 7 days" />
        <MeetingsCard meetings={day.meetings} today={day.today} readOnly={readOnly} />
      </Card>

      <details className="card min-w-0" data-testid="done-today">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-semibold pointer-coarse:min-h-11">
          <span>Done today ({day.done.length})</span>
          <span className="faint text-xs font-normal">Show</span>
        </summary>
        {day.done.length === 0 ? (
          <p className="faint border-t border-[var(--hairline-3)] px-5 py-4 text-sm">Nothing logged yet today.</p>
        ) : (
          <ul className="divide-y divide-[var(--hairline-3)] border-t border-[var(--hairline-3)]">
            {day.done.map((row) => (
              <li key={row.key} className="flex min-w-0 items-baseline gap-3 px-5 py-2.5 text-sm" data-testid="done-row">
                <span className="faint num w-16 shrink-0 text-xs">{row.at}</span>
                <span className="min-w-0 flex-1 truncate">
                  {row.contactId ? (
                    <Link href={`/dashboard/contacts/${row.contactId}`} className="font-medium hover:underline">
                      {row.who}
                    </Link>
                  ) : row.companyId ? (
                    <Link href={`/dashboard/companies/${row.companyId}`} className="font-medium hover:underline">
                      {row.who}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.who}</span>
                  )}
                  <span className="muted"> · {row.type}{row.words ? ` · ${row.words}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>

      {!readOnly && (
        <Card lit className="min-w-0">
          <CardHeader title="Jump in" />
          <MemberJumpIn today={day.today} />
        </Card>
      )}

      <RememberedDetails
        namespace="myday"
        prefKey="teamMoney"
        initialOpen={teamMoneyOpen}
        className="card min-w-0"
        testId="team-money"
        summary={
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-semibold pointer-coarse:min-h-11">
            <span>Team &amp; money</span>
            <span className="faint text-xs font-normal">Show</span>
          </summary>
        }
      >
        {teamMoney ? <div className="border-t border-[var(--hairline-3)] p-4 sm:p-5">{teamMoney}</div> : null}
      </RememberedDetails>

      <details className="card min-w-0" data-testid="reports-fold">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-semibold pointer-coarse:min-h-11">
          <span>Reports ▸</span>
          <span className="faint text-xs font-normal">Show</span>
        </summary>
        <div className="flex flex-wrap gap-2 border-t border-[var(--hairline-3)] p-4 sm:p-5">
          {REPORT_KEYS.map((key) => (
            <Link key={key} href={`/dashboard?report=${key}`} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="reports-fold-link">
              {REPORT_LABELS[key]}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ------------------------------- Team today ------------------------------- */

function counts(c: RepCounts) {
  const rate = connectRate(c.tries, c.talks);
  return { tries: c.tries, talks: c.talks, rate, booked: c.booked };
}

function loggedWords(at: Date | null, now: Date) {
  if (!at) return { words: "Nothing logged lately", fresh: false };
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  const words =
    minutes < 1 ? "Logged just now" : minutes < 60 ? `Logged ${minutes} min ago` : minutes < 60 * 24 ? `Logged ${Math.round(minutes / 60)}h ago` : `Logged ${Math.round(minutes / 1440)}d ago`;
  return { words, fresh: minutes < 120 };
}

// Team today (decision 9, Owners and Admins): one row per rep who owns
// records or logged a touch lately, on top of the Daily Rundown. Each row
// opens that rep's My day, read-only.
export function TeamTodayStrip({ team, now }: { team: TeamToday; now: Date }) {
  if (team.reps.length === 0 && team.unowned === 0) return null;
  return (
    <Card lit className="mb-5 min-w-0">
      <CardHeader
        title="Team today"
        subtitle={team.goals.tries || team.goals.talks || team.goals.booked ? "Today, then this week toward the team's goals" : "Today, then this week"}
      />
      <ul className="divide-y divide-[var(--hairline-3)]" data-testid="team-today">
        {team.reps.map((rep) => {
          const today = counts(rep.numbers.today);
          const week = counts(rep.numbers.week);
          const logged = loggedWords(rep.numbers.lastLoggedAt, now);
          const read = Math.max(1, rep.mix.read);
          return (
            <li key={rep.id}>
              <Link
                href={`/dashboard?view=myday&rep=${rep.id}`}
                className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-[var(--hover)] sm:px-5 md:grid-cols-[auto_minmax(8rem,1fr)_auto_auto_9rem]"
                data-testid="team-row"
                data-rep={rep.id}
              >
                <span className="relative">
                  <Avatar url={rep.avatarUrl} name={rep.name} size={34} round />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--bg)]"
                    style={{ background: logged.fresh ? "var(--health-good)" : "var(--health-none)" }}
                    aria-hidden="true"
                    data-testid="team-dot"
                    data-fresh={logged.fresh ? "" : undefined}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{rep.name}</span>
                  <span className="faint block truncate text-xs">{logged.words}</span>
                </span>
                <span className="col-span-2 flex min-w-0 flex-wrap gap-x-4 text-xs md:col-span-1" data-testid="team-today-numbers">
                  <span>
                    <span className="faint">Today </span>
                    <b className="num max-md:text-base">{today.tries}</b> {today.tries === 1 ? "try" : "tries"} ·{" "}
                    <b className="num max-md:text-base">{today.talks}</b> {today.talks === 1 ? "talk" : "talks"}
                    {today.rate !== null && <span className="faint"> ({today.rate}%)</span>} · <b className="num max-md:text-base">{today.booked}</b> booked
                  </span>
                </span>
                {/* A phone gets the plan's compact card (audit, Nov 11, 2026):
                    name, today's three numbers big, the health bar. The
                    week's rings are one tap away on the rep's My day. */}
                <span className="col-span-2 hidden min-w-0 items-center gap-2 text-xs md:col-span-1 md:flex" data-testid="team-week-numbers">
                  <span className="faint">Week</span>
                  <MiniRing value={week.tries} goal={team.goals.tries} label="tries" />
                  <MiniRing value={week.talks} goal={team.goals.talks} label="talks" />
                  <MiniRing value={week.booked} goal={team.goals.booked} label="booked" />
                </span>
                <span className="col-span-2 min-w-0 md:col-span-1" title={`Book health: ${rep.mix.good} warm, ${rep.mix.warn} cooling, ${rep.mix.risk} cold, ${rep.mix.none} new or trying${rep.mix.read < rep.mix.total ? ` (latest ${rep.mix.read} of ${rep.mix.total})` : ""}`}>
                  <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--hairline-2)]" data-testid="team-health-bar" aria-hidden="true">
                    {rep.mix.read > 0 &&
                      (["good", "warn", "risk", "none"] as const).map((tone) =>
                        rep.mix[tone] > 0 ? <span key={tone} style={{ width: `${(rep.mix[tone] / read) * 100}%`, background: `var(--health-${tone})` }} /> : null,
                      )}
                  </span>
                  <span className="sr-only">
                    Book health: {rep.mix.good} warm, {rep.mix.warn} cooling, {rep.mix.risk} cold
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {team.unowned > 0 && (
        <p className="faint border-t border-[var(--hairline-3)] px-5 py-2.5 text-xs" data-testid="team-unowned">
          {team.unowned} new {team.unowned === 1 ? "lead" : "leads"} nobody owns or has touched.{" "}
          {/* The same people the count is (audit, Nov 11, 2026): rep=none
              alone listed every unowned contact, worked or not. */}
          <Link href="/dashboard/contacts?rep=none&status=NOT_ACTIONED&act=never" className="link" data-testid="team-unowned-link">
            See them
          </Link>
        </p>
      )}
    </Card>
  );
}

// A number with a small ring toward its goal, or the bare number with no goal.
function MiniRing({ value, goal, label }: { value: number; goal: number | null; label: string }) {
  if (!goal) {
    return (
      <span>
        <b className="num">{value}</b> {label}
      </span>
    );
  }
  const size = 22;
  const r = 8.5;
  const c = 2 * Math.PI * r;
  const fill = Math.min(1, value / goal);
  return (
    <span className="inline-flex items-center gap-1" title={`${value} of ${goal} ${label}`}>
      <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" className="-rotate-90">
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--hairline-2)" strokeWidth="3" />
        {fill > 0 && <circle cx="11" cy="11" r={r} fill="none" stroke="var(--brand)" strokeWidth="3" strokeDasharray={`${c * fill} ${c}`} strokeLinecap="round" />}
      </svg>
      <span>
        <b className="num">{value}</b>
        <span className="faint">/{goal}</span> {label}
      </span>
    </span>
  );
}
