import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { prefWords, readUiPrefsWithLegacy } from "@/lib/user-prefs";
import { formatCents, formatDate, pct } from "@/lib/format";
import { CONTACT_STATUS_LABELS, type ContactStatusValue } from "@/lib/constants";
import { loadStats, PERIODS, type PeriodKey, type RepRow } from "@/lib/stats";
import { sweepStaleContracts } from "@/lib/status";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { readIds } from "@/lib/calendar-filters";
import { changeSize, TRY_TALK_COLORS, TRY_TALK_SERIES } from "@/lib/reports/format";
import { readLeaderboardColumns, type LeaderboardRow } from "@/lib/stats-columns";
import { Columns } from "@/app/dashboard/reports/charts";
import { FunnelBars, RepActivityBars, VelocityBars } from "./charts";
import { Leaderboard } from "./leaderboard";
import { ForecastReps } from "./forecast";
import { forecastWindow, loadForecast, storedForecastNotes } from "@/lib/forecast";
import { zonedMoment } from "@/lib/calendar-auto";
import { addDays } from "@/lib/payments";
import { aiConfigured } from "@/lib/ai";
import { todayIso } from "@/lib/payments";

type Params = Promise<{ period?: string; reps?: string; from?: string; to?: string }>;

// The funnel Stats shows (Nov 11, 2026): Interested is a side step a
// person may skip, so it stays in the counts (and the Columns menu's
// people steps) but not in the funnel, and each step's rate is against
// the step before it.
const FUNNEL_STEPS = ["CONTACTED", "CONNECTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"] as const;

function leaderboardRow(rep: RepRow, name = rep.name): LeaderboardRow {
  return {
    id: rep.id,
    name,
    values: {
      tries: rep.tries,
      talks: rep.talks,
      connectRate: rep.connectRate,
      booked: rep.booked,
      held: rep.held,
      wonCents: rep.wonCents,
      showRate: rep.showRate,
      calls: rep.activities.PHONE_CALL,
      texts: rep.activities.TEXT,
      emails: rep.activities.EMAIL,
      meetings: rep.activities.MEETING,
      attempted: rep.steps.CONTACTED,
      connected: rep.steps.CONNECTED,
      meetingSet: rep.steps.MEETING_SET,
      meetingCompleted: rep.steps.MEETING_COMPLETED,
      quotes: rep.steps.QUOTE_SENT,
      contracts: rep.steps.CONTRACT_SENT,
      won: rep.steps.WON,
      closeRate: rep.closeRate,
    },
  };
}

// Stats / Reporting (Sept 30, 2026; the BDR's numbers first since Nov 11,
// 2026): tries and talks, meetings booked and held, the funnel from
// Attempted to Won, how long each hand-off takes, what is open now, and a
// leaderboard. Everyone sees everyone's numbers; a Member opens on their
// own, with Everyone one tap away (decision 17).
export default async function StatsPage({ searchParams }: { searchParams: Params }) {
  const { organizationId, userId, role } = await requireSession();
  const params = await searchParams;
  const period: PeriodKey = params.period && params.period in PERIODS ? (params.period as PeriodKey) : "30d";
  const member = role === "MEMBER";
  // "all" is Everyone picked on purpose; nothing in the address is the
  // default — the whole team, or a Member's own numbers.
  const everyone = params.reps === "all";
  const asked = everyone ? [] : readIds(params.reps, 20);
  const repIds = asked.length ? asked : member && !everyone && params.reps === undefined ? [userId] : [];
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  // A custom From–To (Taylor, Nov 13, 2026), beside the period buttons.
  // What has happened is counted up to today; the forecast takes whatever
  // part of the dates is still ahead.
  const custom = readCustomRange(params.from, params.to);
  // Dates that were sent and couldn't be used say so (audit fix, Nov 13,
  // 2026: the page fell back to 30 days in silence).
  const refused = !custom && (params.from || params.to) ? { from: params.from ?? "", to: params.to ?? "" } : null;
  const range = custom
    ? (() => {
        const start = zonedMoment(custom.from, "00:00", timeZone);
        const end = zonedMoment(addDays(custom.to, 1), "00:00", timeZone);
        const now = new Date();
        const to = end < now ? end : now;
        return { from: start, to: to < start ? start : to };
      })()
    : undefined;
  const window = custom ? forecastWindow(today, custom.from, custom.to) : null;

  await sweepStaleContracts(organizationId);
  const [stats, users, me, forecast] = await Promise.all([
    loadStats(organizationId, { period, userIds: repIds, timeZone, range }),
    loadWorkspaceUsers(organizationId),
    readUiPrefsWithLegacy(userId),
    // The forecast follows the rep filter (Members open on Me). It looks
    // ahead: the period buttons look back and leave it on this month and
    // next; picked dates that reach past today narrow it to those dates.
    loadForecast(organizationId, { today, repIds, timeZone, window }),
  ]);
  const forecastStored = await storedForecastNotes(organizationId, repIds, forecast);
  const t = stats.totals;
  const p = stats.previous;
  const rate = (a: number, b: number) => (b ? a / b : null);
  // uiPrefs stats.columns; the top-level statsColumns an earlier build
  // saved is read when that isn't set.
  const columns = readLeaderboardColumns(prefWords(me.prefs, "stats", "columns") ?? me.legacy.statsColumns);

  const href = (changes: { period?: string; reps?: string[] }) => {
    const search = new URLSearchParams();
    const nextPeriod = changes.period ?? period;
    // Picking a period button leaves the custom dates; changing reps keeps them.
    if (custom && !changes.period) {
      search.set("from", custom.from);
      search.set("to", custom.to);
    } else if (nextPeriod !== "30d") search.set("period", nextPeriod);
    const nextReps = changes.reps ?? repIds;
    if (nextReps.length) search.set("reps", nextReps.join(","));
    // A Member's Everyone has to say so, or the page opens on them again.
    else if (member) search.set("reps", "all");
    const query = search.toString();
    return `/dashboard/stats${query ? `?${query}` : ""}`;
  };
  const toggleRep = (id: string) => (repIds.includes(id) ? repIds.filter((r) => r !== id) : [...repIds, id]);
  const justMe = repIds.length === 1 && repIds[0] === userId;

  const funnel = FUNNEL_STEPS.map((step, index) => ({
    key: step,
    label: CONTACT_STATUS_LABELS[step as ContactStatusValue],
    value: t.steps[step],
    rate: index > 0 ? rate(t.steps[step], t.steps[FUNNEL_STEPS[index - 1]]) : null,
    from: index > 0 ? CONTACT_STATUS_LABELS[FUNNEL_STEPS[index - 1] as ContactStatusValue] : null,
  }));
  const talksSince = stats.talksSince ? formatDate(stats.talksSince, timeZone) : null;

  return (
    <div className="stats-root" data-testid="stats-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--brand)]">Stats / Reporting</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sales command center</h1>
          <p className="faint mt-1 text-sm" data-testid="stats-period-line">
            {custom ? `${dayWords(custom.from)} – ${dayWords(custom.to)}` : `Last ${PERIODS[period].label}`}
            {justMe ? " · just you" : repIds.length ? ` · ${repIds.length} ${repIds.length === 1 ? "rep" : "reps"}` : " · the whole team"} · compared with the{" "}
            {custom ? "same number of days before" : `${PERIODS[period].label} before`}
          </p>
          {refused && (
            <p className="mt-1 text-xs text-[var(--warn)]" role="status" data-testid="stats-dates-refused">
              Those dates couldn&apos;t be used: From has to be on or before To, and no more than three years apart. Showing the last {PERIODS[period].label} instead.
            </p>
          )}
          {custom && custom.from > today && (
            <p className="faint mt-1 text-xs" data-testid="stats-dates-ahead">
              These dates are still ahead, so there is nothing to count yet. The forecast below covers them.
            </p>
          )}
          {talksSince && (
            <p className="faint mt-1 text-xs" data-testid="stats-talks-since">
              Talks counted from {talksSince}, when the app started recording how each touch went.
            </p>
          )}
        </div>
      </div>

      {/* One row of filters above everything they scope. */}
      <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="stats-filters">
        <div className="flex flex-wrap items-start gap-1" role="group" aria-label="Period">
          {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
            <Link
              key={key}
              href={href({ period: key })}
              className={`btn btn-sm pointer-coarse:min-h-11 ${key === period && !custom ? "btn-primary" : "btn-ghost"}`}
              aria-current={key === period && !custom ? "true" : undefined}
            >
              {PERIODS[key].label}
            </Link>
          ))}
          <CustomRange from={custom?.from ?? refused?.from ?? ""} to={custom?.to ?? refused?.to ?? ""} reps={params.reps ?? ""} active={Boolean(custom || refused)} />
        </div>
        <span className="mx-1 hidden h-5 w-px bg-[var(--border)] sm:block" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Reps">
          <Link
            href={href({ reps: [] })}
            className={`btn btn-sm pointer-coarse:min-h-11 ${repIds.length === 0 ? "btn-primary" : "btn-ghost"}`}
            aria-current={repIds.length === 0 ? "true" : undefined}
            data-testid="stats-everyone"
          >
            Everyone
          </Link>
          {member && (
            <Link
              href={href({ reps: [userId] })}
              className={`btn btn-sm pointer-coarse:min-h-11 ${justMe ? "btn-primary" : "btn-ghost"}`}
              aria-current={justMe ? "true" : undefined}
              data-testid="stats-me"
            >
              Me
            </Link>
          )}
          {users
            .filter((user) => (!user.name.endsWith("(removed)") || repIds.includes(user.id)) && !(member && user.id === userId))
            .map((user) => (
              <Link
                key={user.id}
                href={href({ reps: toggleRep(user.id) })}
                className={`btn btn-sm pointer-coarse:min-h-11 ${repIds.includes(user.id) ? "btn-primary" : "btn-ghost"}`}
                aria-current={repIds.includes(user.id) ? "true" : undefined}
                data-testid="stats-rep"
              >
                {user.name}
              </Link>
            ))}
        </div>
      </div>

      {/* Headline numbers: the BDR's day first. */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="stats-tiles">
        <Tile id="tries" label="Tries" value={t.tries} before={p.tries} sub="Calls, texts, emails, meetings" />
        <Tile id="talks" label="Talks" value={t.talks} before={p.talks} sub="Talked, replied or held" />
        <Tile id="connect-rate" label="Connect rate" value={t.connectRate} before={p.connectRate} format="rate" sub="Talks ÷ tries" />
        <Tile id="booked" label="Meetings booked" value={t.booked} before={p.booked} sub="Credited to who booked" />
        <Tile id="show-rate" label="Show rate" value={t.showRate} before={p.showRate} format="rate" sub={`${t.held} held of ${t.due} that came due`} />
        <Tile id="won" label="Won $" value={t.wonCents} before={p.wonCents} format="money" sub={`${t.steps.WON} ${t.steps.WON === 1 ? "customer" : "customers"}`} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="stats-rates">
        <Rate label="Meeting conversion" hint="Quotes sent ÷ meetings completed" value={rate(t.steps.QUOTE_SENT, t.steps.MEETING_COMPLETED)} />
        <Rate label="Contract conversion" hint="Contracts sent ÷ quotes sent" value={rate(t.steps.CONTRACT_SENT, t.steps.QUOTE_SENT)} />
        <Rate label="Close rate" hint="Won ÷ (won + lost)" value={t.closeRate} testId="stats-close-rate" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="The funnel" sub="People reaching each step in the period, and the rate from the step before" className="xl:col-span-2">
          <FunnelBars steps={funnel} />
        </Panel>
        <Panel title="Tries and talks per day" sub="Every bar is the day's tries; the green part connected" className="xl:col-span-3">
          <Columns
            buckets={stats.daily.map((day) => ({ label: day.day, parts: [day.total - day.talks, day.talks] }))}
            series={TRY_TALK_SERIES}
            colors={TRY_TALK_COLORS}
            format="count"
            label="Team activity per day"
            testId="stats-daily"
          />
          <ShowNumbers testId="stats-daily-numbers">
            <table className="table table-stack text-xs" data-testid="stats-daily-table" data-days={stats.daily.length}>
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="text-right">Tries</th>
                  <th className="text-right">Talks</th>
                  <th className="text-right">Calls</th>
                  <th className="text-right">Texts</th>
                  <th className="text-right">Emails</th>
                  <th className="text-right">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {stats.daily
                  .filter((day) => day.total > 0)
                  .map((day) => (
                    <tr key={day.day}>
                      <td className="whitespace-nowrap">{formatDate(`${day.day}T12:00:00Z`, "UTC")}</td>
                      <td className="num text-right" data-label="Tries">{day.total}</td>
                      <td className="num text-right" data-label="Talks">{day.talks}</td>
                      <td className="num text-right" data-label="Calls">{day.byType.PHONE_CALL}</td>
                      <td className="num text-right" data-label="Texts">{day.byType.TEXT}</td>
                      <td className="num text-right" data-label="Emails">{day.byType.EMAIL}</td>
                      <td className="num text-right" data-label="Meetings">{day.byType.MEETING}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </ShowNumbers>
        </Panel>
        <Panel title="Tries and talks by rep" sub="The green part of each bar connected" className="xl:col-span-3">
          {stats.reps.length ? (
            <RepActivityBars
              reps={stats.reps.map((rep) => ({ name: rep.name, values: [rep.tries - rep.talks, rep.talks] }))}
              series={TRY_TALK_SERIES}
              colors={TRY_TALK_COLORS}
            />
          ) : (
            <p className="faint text-sm">No reps to show.</p>
          )}
        </Panel>
        <Panel title="Time between steps" sub="Average days, for people who reached the later step in the period" className="xl:col-span-2">
          <VelocityBars
            rows={stats.velocity.map((pair) => ({
              label: `${CONTACT_STATUS_LABELS[pair.from as ContactStatusValue]} → ${CONTACT_STATUS_LABELS[pair.to as ContactStatusValue]}`,
              days: pair.days,
              samples: pair.samples,
            }))}
          />
          <p className="faint mt-3 text-[0.68rem]">Counted from Sept 30, 2026, when the app started recording each step&apos;s date.</p>
        </Panel>
      </div>

      <Panel title="Open right now" sub="Not limited to the period" className="mt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini label="In Meeting Set" value={String(stats.pipelineNow.meetingSet)} />
          <Mini label="In Meeting Completed" value={String(stats.pipelineNow.meetingCompleted)} />
          <Mini label={`Quotes out (${stats.pipelineNow.quoteCount})`} value={formatCents(stats.pipelineNow.quoteCents)} />
          <Mini label={`Contracts out (${stats.pipelineNow.contractCount})`} value={formatCents(stats.pipelineNow.contractCents)} />
        </div>
      </Panel>

      <Panel title="Leaderboard" sub="Every rep; more numbers under Columns" className="mt-4">
        <Leaderboard rows={stats.reps.map((rep) => leaderboardRow(rep))} team={leaderboardRow(t, "Team")} initialColumns={columns} />
        <p className="faint mt-3 text-[0.68rem]">
          Tries and talks count each save once, so a call logged on three people is one try. Meetings booked and held belong to whoever booked them; Won $ to the deal&apos;s rep. People
          are counted once per step, and the team row counts each person once even when two reps moved them.
        </p>
      </Panel>

      <Panel
        title="Forecast"
        sub={
          forecast.window
            ? `What's likely to sign ${forecast.window.label}, from quotes and contracts out now. Follows the picked dates and the rep filter.`
            : `What's likely to sign in ${forecast.thisMonth} and ${forecast.nextMonth}, from quotes and contracts out now. Follows the rep filter; pick dates ahead of today to forecast those.`
        }
        className="mt-4"
      >
        <div data-testid="forecast">
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${forecast.lowConfidence ? "bg-[var(--tint-2)] text-[var(--text)]" : "faint"}`}
            data-testid="forecast-confidence"
            data-low={forecast.lowConfidence ? "" : undefined}
          >
            {forecast.lowConfidence && <span className="mr-1 font-semibold text-[var(--warn)]">Low confidence.</span>}{" "}
            {forecast.confidenceNote}
          </p>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {forecast.window ? (
              <>
                <Mini label={`Likely ${forecast.window.label}`} value={formatCents(forecast.totals.windowCents)} />
                <Mini label="Days ahead in the dates" value={String(Math.round((Date.parse(forecast.window.to) - Date.parse(forecast.window.from)) / 86_400_000) + 1)} />
              </>
            ) : (
              <>
                <Mini label={`Likely in ${forecast.thisMonth}`} value={formatCents(forecast.totals.thisCents)} />
                <Mini label={`Likely in ${forecast.nextMonth}`} value={formatCents(forecast.totals.nextCents)} />
              </>
            )}
            <Mini label={`Out now (${forecast.totals.deals})`} value={formatCents(forecast.totals.openCents)} />
            <Mini label="Running long" value={String(forecast.reps.reduce((sum, rep) => sum + rep.long, 0))} />
          </div>
          {forecast.window?.rough && (
            <p className="mb-2 text-xs text-[var(--warn)]" data-testid="forecast-rough">
              Rough: past the end of {forecast.nextMonth} the forecast is a guess, since few deals are decided that far out.
            </p>
          )}
          {custom && !forecast.window && (
            <p className="faint mb-2 text-xs" data-testid="forecast-past-dates">
              Those dates are behind us, so the forecast shows this month and next. The numbers above count what happened in them.
            </p>
          )}
          {forecast.leftOut > 0 && (
            <p className="mb-2 text-xs text-[var(--warn)]" data-testid="forecast-left-out">
              Counting the newest {(forecast.totals.deals).toLocaleString("en-US")} open deals; {forecast.leftOut.toLocaleString("en-US")} older ones are left out.
            </p>
          )}
          <ForecastReps
            key={`${repIds.join(",") || "all"}|${forecast.window ? `${forecast.window.from}..${forecast.window.to}` : "default"}|${forecastStored ? "kept" : "new"}|${forecast.reps.map((rep) => `${rep.id}:${rep.thisCents}:${rep.nextCents}:${rep.deals}`).join(",")}`}
            rows={forecast.reps.map((rep) => ({
              id: rep.id,
              name: rep.name,
              columns: forecast.window
                ? [{ label: "in the dates", value: formatCents(rep.windowCents), testId: "forecast-window" }]
                : [
                    { label: forecast.thisMonth, value: formatCents(rep.thisCents), testId: "forecast-this" },
                    { label: forecast.nextMonth, value: formatCents(rep.nextCents), testId: "forecast-next" },
                  ],
              open: formatCents(rep.openCents),
              deals: rep.deals,
              long: rep.long,
              sentence: rep.sentence,
            }))}
            repIds={repIds}
            ai={aiConfigured()}
            stored={forecastStored}
            dates={forecast.window ? { from: custom!.from, to: custom!.to } : null}
          />
          {forecast.long.length > 0 && (
            <div className="mt-4" data-testid="forecast-long">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">Running past the usual time</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {forecast.long.map((deal) => (
                  <li key={deal.id} className="min-w-0 [overflow-wrap:anywhere]" data-testid="forecast-long-deal">
                    <Link href={`/dashboard/contacts/${deal.contactId}`} className="link">
                      {deal.title}
                    </Link>{" "}
                    <span className="faint text-xs">
                      · {deal.contactName} · {deal.rep} · {deal.stage === "QUOTE_SENT" ? "Quote Sent" : "Contract Sent"} {deal.ageDays} days (usually {deal.usualDays}) · {formatCents(deal.valueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-3">
            <summary className="link inline-flex min-h-11 cursor-pointer items-center text-xs sm:min-h-0">How this is worked out</summary>
            <ul className="faint mt-1 space-y-1 text-xs" data-testid="forecast-rates">
              {forecast.rates.map((rate) => (
                <li key={rate.stage}>{rate.sentence}</li>
              ))}
              <li>Each open deal counts its value times that chance, in the month it usually signs. Past twice the usual time, its chance is halved.</li>
            </ul>
          </details>
        </div>
      </Panel>
    </div>
  );
}

// The duplicate table under a chart, one tap away (Nov 11, 2026).
function ShowNumbers({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <details className="mt-3" data-testid={testId}>
      <summary className="link inline-flex min-h-11 cursor-pointer items-center text-xs sm:min-h-0">Show numbers</summary>
      <div className="-mx-1 mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

// The VP / BDR / CRO / AE chips that sat in each panel's corner are gone
// (Nov 11, 2026): nobody knew what they meant.
function Panel({ title, sub, className = "", children }: { title: string; sub: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card card-lit stats-panel min-w-0 p-5 ${className}`}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="faint text-xs">{sub}</p>
      </div>
      {children}
    </section>
  );
}

// The change line follows the reports' rule (changeSize): a rise from 0
// reads "new this period", never "▲ 100%" (UX review, Nov 10, 2026); a rate
// moves in points.
function Tile({
  id,
  label,
  value,
  before,
  format = "count",
  sub,
}: {
  id: string;
  label: string;
  value: number | null;
  before: number | null;
  format?: "count" | "money" | "rate";
  sub?: string;
}) {
  const shown = value === null ? "—" : format === "money" ? formatCents(value) : format === "rate" ? pct(value) : value.toLocaleString();
  let line: React.ReactNode = null;
  let tone = "faint";
  if (value !== null && before !== null) {
    if (value === before) line = "— same as before";
    else {
      const change = changeSize(value, before, format === "rate" ? "percent" : format);
      tone = value > before ? "text-[var(--ok)]" : "text-[var(--danger)]";
      line = `${change.text}${change.fromZero ? "" : " vs before"}`;
    }
  } else if (value !== null && before === null && format === "rate") line = "nothing to compare";
  return (
    <div className="card card-lit stats-tile min-w-0 p-4" data-testid="stats-tile" data-id={id} data-value={value ?? ""}>
      <p className="faint text-[0.68rem] uppercase tracking-[0.14em]">{label}</p>
      <p className="num mt-2 text-2xl font-semibold tracking-tight" data-testid="stats-tile-value">
        {shown}
      </p>
      {line && (
        <p className={`num mt-1 text-[0.7rem] ${tone}`} data-testid="stats-tile-change">
          {line}
        </p>
      )}
      {sub && <p className="faint text-[0.68rem]">{sub}</p>}
    </div>
  );
}

function Rate({ label, hint, value, testId }: { label: string; hint: string; value: number | null; testId?: string }) {
  return (
    <div className="card card-lit p-4" data-testid={testId}>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium">{label}</p>
        <p className="num text-lg font-semibold">{value === null ? "—" : pct(value)}</p>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-[var(--hover-strong)]">
        <div className="h-1.5 rounded-full bg-[var(--brand)] shadow-[0_0_10px_var(--brand)]" style={{ width: `${Math.min(100, Math.round((value ?? 0) * 100))}%` }} />
      </div>
      <p className="faint mt-1.5 text-[0.66rem]">{hint}</p>
    </div>
  );
}

// From–To in the address bar: real days, From on or before To, at most
// three years apart. Anything else is ignored and the period buttons rule.
function readCustomRange(from?: string, to?: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !day.test(from) || !day.test(to)) return null;
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || b - a > 3 * 366 * 86_400_000) return null;
  if (new Date(a).toISOString().slice(0, 10) !== from || new Date(b).toISOString().slice(0, 10) !== to) return null;
  return { from, to };
}

function dayWords(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// "Custom" beside the period buttons: two dates and Apply, as a plain form
// (works before the page's JavaScript loads). The reps picked stay.
function CustomRange({ from, to, reps, active }: { from: string; to: string; reps: string; active: boolean }) {
  return (
    <details className="relative" open={active || undefined} data-testid="stats-custom">
      <summary className={`btn btn-sm pointer-coarse:min-h-11 cursor-pointer list-none ${active ? "btn-primary" : "btn-ghost"}`} data-testid="stats-custom-toggle">
        Custom
      </summary>
      <form method="get" action="/dashboard/stats" className="mt-1 flex flex-wrap items-end gap-2" data-testid="stats-custom-form">
        {reps && <input type="hidden" name="reps" value={reps} />}
        <label className="text-xs">
          <span className="faint block">From</span>
          <input type="date" name="from" defaultValue={from} required className="input input-sm" data-testid="stats-from" />
        </label>
        <label className="text-xs">
          <span className="faint block">To</span>
          <input type="date" name="to" defaultValue={to} required className="input input-sm" data-testid="stats-to" />
        </label>
        <button type="submit" className="btn btn-primary btn-sm pointer-coarse:min-h-11" data-testid="stats-custom-apply">
          Apply
        </button>
      </form>
    </details>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="faint text-[0.68rem]">{label}</p>
      <p className="num mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
