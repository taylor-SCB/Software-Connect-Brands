import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { formatCents, pct } from "@/lib/format";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, CONTACT_STATUS_LABELS, type ContactStatusValue } from "@/lib/constants";
import { loadStats, FUNNEL, PERIODS, type PeriodKey } from "@/lib/stats";
import { sweepStaleContracts } from "@/lib/status";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { readIds } from "@/lib/calendar-filters";
import { DailyTrend, FunnelBars, RepActivityBars, VelocityBars } from "./charts";

type Params = Promise<{ period?: string; reps?: string }>;

// Stats / Reporting (Sept 30, 2026): a CRO's view of the sales floor, from
// the BDR's day (touches, people reached, meetings booked) through the
// AE's (meetings held, quotes and contracts out, close rate) to the VP's
// (the team funnel, how long each hand-off takes, what is open now).
// Everyone sees everyone's numbers for now (Taylor: no permissions yet).
export default async function StatsPage({ searchParams }: { searchParams: Params }) {
  const { organizationId } = await requireSession();
  const params = await searchParams;
  const period: PeriodKey = params.period && params.period in PERIODS ? (params.period as PeriodKey) : "30d";
  const repIds = readIds(params.reps, 20);
  const timeZone = await getTimeZone();

  await sweepStaleContracts(organizationId);
  const [stats, users] = await Promise.all([
    loadStats(organizationId, { period, userIds: repIds, timeZone }),
    loadWorkspaceUsers(organizationId),
  ]);
  const t = stats.totals;
  const p = stats.previous;
  const rate = (a: number, b: number) => (b ? a / b : null);

  const href = (changes: { period?: string; reps?: string[] }) => {
    const search = new URLSearchParams();
    const nextPeriod = changes.period ?? period;
    if (nextPeriod !== "30d") search.set("period", nextPeriod);
    const nextReps = changes.reps ?? repIds;
    if (nextReps.length) search.set("reps", nextReps.join(","));
    const query = search.toString();
    return `/dashboard/stats${query ? `?${query}` : ""}`;
  };
  const toggleRep = (id: string) => (repIds.includes(id) ? repIds.filter((r) => r !== id) : [...repIds, id]);

  // Interested is a side step a person may skip, so Meeting Set is
  // measured against Contacted, not against Interested.
  const base = (index: number) => (FUNNEL[index] === "MEETING_SET" ? "CONTACTED" : FUNNEL[index - 1]);
  const funnel = FUNNEL.map((step, index) => ({
    label: CONTACT_STATUS_LABELS[step as ContactStatusValue],
    value: t.steps[step],
    rate: index > 0 ? rate(t.steps[step], t.steps[base(index)]) : null,
    from: index > 0 ? CONTACT_STATUS_LABELS[base(index) as ContactStatusValue] : null,
  }));

  return (
    <div className="stats-root" data-testid="stats-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[var(--brand)]">Stats / Reporting</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sales command center</h1>
          <p className="faint mt-1 text-sm">
            Last {PERIODS[period].label}
            {repIds.length ? ` · ${repIds.length} ${repIds.length === 1 ? "rep" : "reps"}` : " · the whole team"} · compared with the {PERIODS[period].label} before
          </p>
        </div>
      </div>

      {/* One row of filters above everything they scope. */}
      <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="stats-filters">
        <div className="flex gap-1" role="group" aria-label="Period">
          {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
            <Link key={key} href={href({ period: key })} className={`btn btn-sm ${key === period ? "btn-primary" : "btn-ghost"}`} aria-current={key === period ? "true" : undefined}>
              {PERIODS[key].label}
            </Link>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Reps">
          <Link href={href({ reps: [] })} className={`btn btn-sm ${repIds.length === 0 ? "btn-primary" : "btn-ghost"}`}>
            Everyone
          </Link>
          {users
            .filter((user) => !user.name.endsWith("(removed)") || repIds.includes(user.id))
            .map((user) => (
              <Link
                key={user.id}
                href={href({ reps: toggleRep(user.id) })}
                className={`btn btn-sm ${repIds.includes(user.id) ? "btn-primary" : "btn-ghost"}`}
                data-testid="stats-rep"
              >
                {user.name}
              </Link>
            ))}
        </div>
      </div>

      {/* Headline numbers. */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="stats-tiles">
        <Tile label="Touches" value={t.activityTotal} before={p.activityTotal} />
        <Tile label="Meetings set" value={t.steps.MEETING_SET} before={p.steps.MEETING_SET} />
        <Tile label="Meetings held" value={t.steps.MEETING_COMPLETED} before={p.steps.MEETING_COMPLETED} />
        <Tile label="Quotes sent" value={t.steps.QUOTE_SENT} before={p.steps.QUOTE_SENT} />
        <Tile label="Contracts sent" value={t.steps.CONTRACT_SENT} before={p.steps.CONTRACT_SENT} />
        <Tile label="Signed / Won" value={t.wonCents} before={p.wonCents} money sub={`${t.steps.WON} ${t.steps.WON === 1 ? "customer" : "customers"}`} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="stats-rates">
        <Rate label="Meeting show rate" hint="Meetings held ÷ meetings set" value={rate(t.steps.MEETING_COMPLETED, t.steps.MEETING_SET)} />
        <Rate label="Meeting conversion" hint="Quotes sent ÷ meetings held" value={rate(t.steps.QUOTE_SENT, t.steps.MEETING_COMPLETED)} />
        <Rate label="Contract conversion" hint="Contracts sent ÷ quotes sent" value={rate(t.steps.CONTRACT_SENT, t.steps.QUOTE_SENT)} />
        <Rate label="Close rate" hint="Won ÷ (won + lost)" value={t.closeRate} testId="stats-close-rate" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="The funnel" kicker="VP" sub="People reaching each step in the period" className="xl:col-span-2">
          <FunnelBars steps={funnel} />
        </Panel>
        <Panel title="Touches per day" kicker="BDR" sub="Calls, emails, texts and meetings logged by the team" className="xl:col-span-3">
          <DailyTrend
            days={stats.daily.map((day) => ({ day: day.day, total: day.total, parts: ACTIVITY_TYPES.map((type) => day.byType[type]) }))}
            series={ACTIVITY_TYPES.map((type) => ACTIVITY_LABELS[type])}
          />
        </Panel>
        <Panel title="Activity by rep" kicker="BDR" sub="Every touch logged, by kind" className="xl:col-span-3">
          {stats.reps.length ? (
            <RepActivityBars
              reps={stats.reps.map((rep) => ({ name: rep.name, values: ACTIVITY_TYPES.map((type) => rep.activities[type]) }))}
              series={ACTIVITY_TYPES.map((type) => ACTIVITY_LABELS[type])}
            />
          ) : (
            <p className="faint text-sm">No reps to show.</p>
          )}
        </Panel>
        <Panel title="Time between steps" kicker="VP" sub="Average days, for people who reached the later step in the period" className="xl:col-span-2">
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

      <Panel title="Open right now" kicker="AE" sub="Not limited to the period" className="mt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini label="In Meeting Set" value={String(stats.pipelineNow.meetingSet)} />
          <Mini label="In Meeting Completed" value={String(stats.pipelineNow.meetingCompleted)} />
          <Mini label={`Quotes out (${stats.pipelineNow.quoteCount})`} value={formatCents(stats.pipelineNow.quoteCents)} />
          <Mini label={`Contracts out (${stats.pipelineNow.contractCount})`} value={formatCents(stats.pipelineNow.contractCents)} />
        </div>
      </Panel>

      <Panel title="Leaderboard" kicker="CRO" sub="Every rep, every number — the table behind the charts" className="mt-4">
        <div className="overflow-x-auto">
          <table className="table text-xs" data-testid="stats-leaderboard">
            <thead>
              <tr>
                <th>Rep</th>
                {ACTIVITY_TYPES.map((type) => (
                  <th key={type} className="text-right">
                    {ACTIVITY_LABELS[type]}
                  </th>
                ))}
                <th className="text-right">Contacted</th>
                <th className="text-right">Mtg set</th>
                <th className="text-right">Mtg held</th>
                <th className="text-right">Quotes</th>
                <th className="text-right">Contracts</th>
                <th className="text-right">Won</th>
                <th className="text-right">Won $</th>
                <th className="text-right">Close rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.reps.map((rep) => (
                <tr key={rep.id} data-testid="stats-rep-row">
                  <td className="font-medium">{rep.name}</td>
                  {ACTIVITY_TYPES.map((type) => (
                    <td key={type} className="num text-right">
                      {rep.activities[type]}
                    </td>
                  ))}
                  <td className="num text-right">{rep.steps.CONTACTED}</td>
                  <td className="num text-right">{rep.steps.MEETING_SET}</td>
                  <td className="num text-right">{rep.steps.MEETING_COMPLETED}</td>
                  <td className="num text-right">{rep.steps.QUOTE_SENT}</td>
                  <td className="num text-right">{rep.steps.CONTRACT_SENT}</td>
                  <td className="num text-right">{rep.steps.WON}</td>
                  <td className="num text-right">{formatCents(rep.wonCents)}</td>
                  <td className="num text-right">{rep.closeRate === null ? "—" : pct(rep.closeRate)}</td>
                </tr>
              ))}
              <tr className="font-semibold" data-testid="stats-team-row">
                <td>Team</td>
                {ACTIVITY_TYPES.map((type) => (
                  <td key={type} className="num text-right">
                    {t.activities[type]}
                  </td>
                ))}
                <td className="num text-right">{t.steps.CONTACTED}</td>
                <td className="num text-right">{t.steps.MEETING_SET}</td>
                <td className="num text-right">{t.steps.MEETING_COMPLETED}</td>
                <td className="num text-right">{t.steps.QUOTE_SENT}</td>
                <td className="num text-right">{t.steps.CONTRACT_SENT}</td>
                <td className="num text-right">{t.steps.WON}</td>
                <td className="num text-right">{formatCents(t.wonCents)}</td>
                <td className="num text-right">{t.closeRate === null ? "—" : pct(t.closeRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="faint mt-3 text-[0.68rem]">
          People are counted once per step. A step that came with a deal — a quote or contract out, a win or a loss — is the deal&apos;s rep&apos;s; any other step belongs to whoever made the move.
          The team row counts each person once even when two reps moved them.
        </p>
      </Panel>
    </div>
  );
}

function Panel({ title, kicker, sub, className = "", children }: { title: string; kicker: string; sub: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card card-lit stats-panel p-5 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="faint text-xs">{sub}</p>
        </div>
        <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[0.6rem] font-semibold tracking-[0.15em] text-[var(--text-faint)]">{kicker}</span>
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, before, money = false, sub }: { label: string; value: number; before: number; money?: boolean; sub?: string }) {
  const change = before ? (value - before) / before : value ? 1 : 0;
  const up = value >= before;
  return (
    <div className="card card-lit stats-tile p-4" data-testid="stats-tile">
      <p className="faint text-[0.68rem] uppercase tracking-[0.14em]">{label}</p>
      <p className="num mt-2 text-2xl font-semibold tracking-tight" data-testid="stats-tile-value">
        {money ? formatCents(value) : value.toLocaleString()}
      </p>
      <p className={`num mt-1 text-[0.7rem] ${value === before ? "faint" : up ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
        {value === before ? "— same as before" : `${up ? "▲" : "▼"} ${Math.abs(Math.round(change * 100))}% vs before`}
      </p>
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
      <div className="mt-2 h-1.5 rounded-full bg-[rgb(255_255_255/0.05)]">
        <div className="h-1.5 rounded-full bg-[var(--brand)] shadow-[0_0_10px_var(--brand)]" style={{ width: `${Math.min(100, Math.round((value ?? 0) * 100))}%` }} />
      </div>
      <p className="faint mt-1.5 text-[0.66rem]">{hint}</p>
    </div>
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
