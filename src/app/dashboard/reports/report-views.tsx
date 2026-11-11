import Link from "next/link";
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from "@/lib/constants";
import { BREAKDOWN_LABELS, type BreakdownKey, type Headline, type SummaryTable } from "@/lib/reports/common";
import type { AnyReport } from "@/lib/reports/index";
import type { DailyReport } from "@/lib/reports/daily";
import type { PipelineReport } from "@/lib/reports/pipeline";
import type { ActivityReport } from "@/lib/reports/activity";
import type { ClosingReport } from "@/lib/reports/closing";
import type { MoneyReport } from "@/lib/reports/money";
import type { PeriodRange } from "@/lib/reports/period";
import { formatIsoDay } from "@/lib/reports/period";
import { changeText, formatValue, headlineValue, money, percent, plural } from "@/lib/reports/format";
import { Columns, HBars } from "./charts";

// The body of each report under its write-up: headline tiles with the
// comparison, the charts, and a compact table behind every chart.

type ViewProps = { range: PeriodRange; by: BreakdownKey };

export function ReportBody({ report, range, by }: { report: AnyReport } & ViewProps) {
  switch (report.kind) {
    case "daily":
      return <DailyView report={report} />;
    case "pipeline":
      return <PipelineView report={report} range={range} by={by} />;
    case "activity":
      return <ActivityView report={report} range={range} by={by} />;
    case "closing":
      return <ClosingView report={report} range={range} by={by} />;
    case "money":
      return <MoneyView report={report} range={range} by={by} />;
  }
}

export function HeadlineTiles({ headlines, compareLabel }: { headlines: Headline[]; compareLabel?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="report-tiles">
      {headlines.map((headline) => {
        const moved = changeText(headline);
        return (
          <div key={headline.id} className="card card-lit p-4" data-testid="report-tile" data-id={headline.id} data-value={headline.value}>
            <p className="faint text-[0.68rem] uppercase tracking-[0.12em]">{headline.label}</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight" data-testid="report-tile-value">
              {headlineValue(headline)}
            </p>
            {moved && (
              <p
                className={`num mt-0.5 text-[0.7rem] ${moved.tone === "flat" ? "faint" : moved.tone === "good" ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}
                data-testid="report-tile-change"
                title={compareLabel ? `Compared with ${compareLabel}: ${formatValue(headline.previous ?? 0, headline.format)}` : undefined}
              >
                {moved.text}
                {compareLabel && moved.tone !== "flat" && !moved.fromZero ? <span className="faint"> vs {formatValue(headline.previous ?? 0, headline.format)}</span> : null}
              </p>
            )}
            {headline.hint && <p className="faint text-[0.68rem]">{headline.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, sub, children, className = "", testId }: { title: string; sub?: string; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`card card-lit min-w-0 p-5 ${className}`} data-testid={testId}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub && <p className="faint text-xs">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ table, testId }: { table: SummaryTable; testId?: string }) {
  if (table.rows.length === 0) return <p className="faint text-sm">Nothing here for this period.</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="table text-xs" data-testid={testId}>
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={column.label} className={index ? "text-right" : ""}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} data-testid={testId ? `${testId}-row` : undefined}>
              {row.map((cell, index) => (
                <td key={index} className={index ? "num text-right" : "font-medium"}>
                  {typeof cell === "number" && table.columns[index]?.format !== "text" ? formatValue(cell, table.columns[index].format as Headline["format"]) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A chart with its table under it, both drawn from the same rows: with no
// rows the panel says so once (UX review, Nov 10, 2026: Money Owed's "Owed
// by rep" stacked the chart's "Nothing to show" over the table's "Nothing
// here").
function ChartAndTable({ empty, chart, table }: { empty: boolean; chart: React.ReactNode; table: React.ReactNode }) {
  if (empty) return <p className="faint text-sm" data-testid="report-empty">Nothing to show for this period.</p>;
  return (
    <>
      {chart}
      <div className="mt-3">{table}</div>
    </>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (now === before) return <span className="faint">—</span>;
  return <span className={now > before ? "text-[var(--ok)]" : "text-[var(--danger)]"}>{now > before ? `+${now - before}` : now - before}</span>;
}

/* ------------------------------- Daily ------------------------------- */

// `count` goes in the heading; `listed` (default: count) says whether there
// are rows to show — the calendar's heading counts only what is still open
// while its done entries are listed after them.
function RundownList({ title, sub, empty, children, count, listed = count, testId, href }: { title: string; sub?: string; empty: string; children: React.ReactNode; count: number; listed?: number; testId: string; href?: string }) {
  return (
    <Panel title={`${title}${count ? ` · ${count}` : ""}`} sub={sub} testId={testId}>
      {listed === 0 ? <p className="faint text-sm">{empty}</p> : <ul className="divide-y divide-[var(--hairline-3)] text-sm">{children}</ul>}
      {href && listed > 0 && (
        <Link href={href} className="link mt-2 inline-block text-xs">
          See all
        </Link>
      )}
    </Panel>
  );
}

function DailyView({ report }: { report: DailyReport }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <RundownList
        title="On the calendar today"
        sub={
          report.calendar.count > report.calendar.open
            ? report.calendar.open
              ? `Still open · ${report.calendar.count - report.calendar.open} already done`
              : `All ${report.calendar.count} done`
            : undefined
        }
        count={report.calendar.open}
        listed={report.calendar.count}
        empty="Nothing on the calendar today."
        testId="rundown-calendar"
        href="/dashboard/calendar"
      >
        {report.calendar.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 py-2" data-done={item.done ? "true" : undefined}>
            <span className={`min-w-0 truncate ${item.done ? "line-through" : ""}`}>
              {item.title}
              <span className="faint block text-[0.7rem]">
                {item.type} · {item.owner}
                {item.who ? ` · ${item.who}` : ""}
              </span>
            </span>
            <span className="num faint shrink-0 text-xs">{item.time ?? "No time set"}</span>
          </li>
        ))}
      </RundownList>
      <RundownList title="Overdue follow-ups" count={report.overdue.count} empty="Nothing overdue. Nice." testId="rundown-overdue" href="/dashboard/calendar">
        {report.overdue.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 truncate">
              {item.title}
              <span className="faint block text-[0.7rem]">
                {item.owner}
                {item.who ? ` · ${item.who}` : ""} · due {formatIsoDay(item.on)}
              </span>
            </span>
            <span className="num shrink-0 text-xs text-[var(--danger)]">{item.days}d late</span>
          </li>
        ))}
      </RundownList>
      <RundownList
        title="Gone quiet"
        sub={`Open opportunities nobody has touched in ${report.quiet.quietDays}+ days`}
        count={report.quiet.count}
        empty="Every open opportunity has been touched recently."
        testId="rundown-quiet"
        href="/dashboard/deals"
      >
        {report.quiet.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 truncate">
              {item.title}
              <span className="faint block text-[0.7rem]">{item.owner}</span>
            </span>
            <span className="num faint shrink-0 text-xs">{item.days} days</span>
          </li>
        ))}
      </RundownList>
      <RundownList title="Paid yesterday" sub={report.payments.count ? money(report.payments.cents) : undefined} count={report.payments.count} empty="No payments recorded yesterday." testId="rundown-payments">
        {report.payments.items.map((item, index) => (
          <li key={index} className="flex justify-between gap-3 py-2">
            <span className="min-w-0 truncate">
              {item.customer}
              {item.method && <span className="faint block text-[0.7rem]">{item.method}</span>}
            </span>
            <span className="num shrink-0">{money(item.cents)}</span>
          </li>
        ))}
      </RundownList>
      <RundownList
        title="Sent yesterday"
        sub={`${plural(report.quotes.count, "quote")} (${money(report.quotes.cents)}) · ${plural(report.contracts.count, "contract")}`}
        count={report.quotes.count + report.contracts.count}
        empty="No quotes or contracts went out yesterday."
        testId="rundown-sent"
      >
        {report.quotes.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 py-2">
            <Link href={`/dashboard/quotes/${item.id}`} className="link min-w-0 truncate">
              Quote QUO-{item.number} · {item.customer}
            </Link>
            <span className="num shrink-0">{money(item.cents)}</span>
          </li>
        ))}
        {report.contracts.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 py-2">
            <Link href={`/dashboard/contracts/${item.id}`} className="link min-w-0 truncate">
              Contract CON-{item.number} · {item.customer}
            </Link>
          </li>
        ))}
      </RundownList>
      <RundownList title="New contacts yesterday" count={report.contacts.count} empty="No new contacts yesterday." testId="rundown-contacts">
        {report.contacts.items.map((item) => (
          <li key={item.id} className="py-2">
            <Link href={`/dashboard/contacts/${item.id}`} className="link">
              {item.name}
            </Link>
            {item.company && <span className="faint text-xs"> · {item.company}</span>}
          </li>
        ))}
      </RundownList>
    </div>
  );
}

/* ------------------------------ Pipeline ------------------------------ */

function PipelineView({ report, range, by }: { report: PipelineReport } & ViewProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Open right now, by stage" sub="Value of the deals at each stage; meetings carry a value only once a deal is on them" testId="pipeline-stages">
        <HBars
          rows={report.stages.map((stage) => ({ label: stage.label, values: [stage.valueCents], note: `${stage.count}` }))}
          series={["Open value"]}
          format="money"
          label="Open pipeline value by stage"
        />
        <div className="mt-3">
          <Table table={report.table} testId="pipeline-stage-table" />
        </div>
      </Panel>
      <Panel title={`What moved · ${range.label.toLowerCase()}`} sub={`Against ${range.compareLabel}. Meetings count people; paperwork counts deals.`} testId="pipeline-moves">
        <div className="-mx-1 overflow-x-auto">
          <table className="table text-xs" data-testid="pipeline-moves-table">
            <thead>
              <tr>
                <th>Step</th>
                <th className="text-right">Now</th>
                <th className="text-right">Before</th>
                <th className="text-right">Change</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {report.moves.map((move) => (
                <tr key={move.step} data-step={move.step}>
                  <td className="font-medium">{move.label}</td>
                  <td className="num text-right">{move.count}</td>
                  <td className="num text-right">{move.previous}</td>
                  <td className="num text-right">
                    <Delta now={move.count} before={move.previous} />
                  </td>
                  <td className="num text-right">{move.step === "MEETING_SET" || move.step === "MEETING_COMPLETED" ? "—" : money(move.valueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2" data-testid="pipeline-conversions">
          {report.conversions.map((row) => (
            <li key={row.to} className="rounded-lg border border-[var(--border)] px-3 py-2">
              <span className="faint">
                {row.from} → {row.to}
              </span>
              <span className="num float-right font-semibold">{row.rate === null ? "—" : percent(row.rate)}</span>
              {row.previousRate !== null && <span className="faint block text-[0.66rem]">was {percent(row.previousRate)}</span>}
            </li>
          ))}
        </ul>
        <p className="faint mt-2 text-xs">
          New opportunities: <strong className="num text-[var(--text)]">{report.newOpportunities.count}</strong> (was {report.newOpportunities.previous})
        </p>
      </Panel>
      <Panel title="How long it has sat" sub="Open items by days in their current stage" testId="pipeline-aging">
        <HBars rows={report.aging.map((bucket) => ({ label: bucket.label, values: [bucket.count], note: money(bucket.valueCents) }))} series={["Open items"]} format="count" label="Open items by age" />
        {report.stuck.length > 0 && (
          <>
            <p className="label mt-4">Waiting longest</p>
            <ul className="divide-y divide-[var(--hairline-3)] text-sm" data-testid="pipeline-stuck">
              {report.stuck.map((item, index) => (
                <li key={index} className="flex justify-between gap-3 py-1.5">
                  <Link href={item.href} className="link min-w-0 truncate">
                    {item.title}
                  </Link>
                  <span className="num faint shrink-0 text-xs">
                    {item.days} days · {money(item.valueCents)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      <Panel title={`Open pipeline by ${BREAKDOWN_LABELS[by].toLowerCase()}`} testId="pipeline-groups">
        <ChartAndTable
          empty={report.groups.length === 0}
          chart={
            <HBars
              rows={report.groups.map((group) => ({ label: group.name, values: [group.quoteCents, group.contractCents], note: `${group.count}` }))}
              series={["Quotes out", "Contracts out"]}
              format="money"
              label={`Open value by ${BREAKDOWN_LABELS[by]}`}
            />
          }
          table={
            <Table
              testId="report-group-table"
              table={{
                title: "",
                columns: [
                  { label: BREAKDOWN_LABELS[by], format: "text" },
                  { label: "Open", format: "count" },
                  { label: "In meetings", format: "count" },
                  { label: "Quotes $", format: "money" },
                  { label: "Contracts $", format: "money" },
                  { label: "Total $", format: "money" },
                ],
                rows: report.groups.map((group) => [group.name, group.count, group.meetings, group.quoteCents, group.contractCents, group.valueCents]),
              }}
            />
          }
        />
      </Panel>
    </div>
  );
}

/* ------------------------------ Activity ------------------------------ */

function ActivityView({ report, by }: { report: ActivityReport } & ViewProps) {
  const series = ACTIVITY_TYPES.map((type) => ACTIVITY_LABELS[type]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={`Touches by ${report.bucket}`} sub="Calls, emails, texts and meetings logged" className="xl:col-span-2" testId="activity-daily">
        <Columns buckets={report.series.map((bucket) => ({ label: bucket.start, parts: bucket.parts }))} series={series} format="count" label="Touches over time by kind" bucketWord={report.bucket} />
      </Panel>
      <Panel title={`Touches by ${BREAKDOWN_LABELS[by].toLowerCase()}`} sub={by === "rep" ? "Who logged them" : "Who they were with"} testId="activity-groups">
        <HBars rows={report.groups.filter((group) => group.touches > 0 || by === "rep").map((group) => ({ label: group.name, values: group.parts }))} series={series} format="count" label={`Touches by ${BREAKDOWN_LABELS[by]}`} />
      </Panel>
      <Panel title="Marketing emails" sub="Their own series — never counted as a touch" testId="activity-marketing">
        <p className="mb-2 text-sm">
          <strong className="num">{report.marketing.toLocaleString("en-US")}</strong> <span className="faint">sent, against {report.previousMarketing.toLocaleString("en-US")} before</span>
        </p>
        <Columns buckets={report.series.map((bucket) => ({ label: bucket.start, parts: [bucket.marketing] }))} series={["Marketing emails"]} format="count" label="Marketing emails over time" bucketWord={report.bucket} />
      </Panel>
      <Panel
        title="Touched and not touched"
        sub={by === "rep" ? "Touches by who logged them; not touched by who owns the person" : "People in each group with no touch in the period"}
        className="xl:col-span-2"
        testId="activity-coverage"
      >
        <p className="mb-3 text-sm">
          <strong className="num">{report.peopleTouched.toLocaleString("en-US")}</strong> people and <strong className="num">{report.companiesTouched.toLocaleString("en-US")}</strong> companies touched ·{" "}
          <strong className="num">{report.untouched.toLocaleString("en-US")}</strong> of {report.people.toLocaleString("en-US")} people not touched
        </p>
        <Table table={report.table} testId="report-group-table" />
      </Panel>
    </div>
  );
}

/* ------------------------------ Closing ------------------------------ */

function ClosingView({ report, by }: { report: ClosingReport } & ViewProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={`Won and lost by ${BREAKDOWN_LABELS[by].toLowerCase()}`} sub="Value of deals decided in the period" testId="closing-groups">
        <ChartAndTable
          empty={report.groups.length === 0}
          chart={
            <HBars
              rows={report.groups.map((group) => ({ label: group.name, values: [group.won.valueCents, group.lost.valueCents], note: group.winRate === null ? undefined : percent(group.winRate) }))}
              series={["Won", "Lost"]}
              format="money"
              label={`Won and lost by ${BREAKDOWN_LABELS[by]}`}
            />
          }
          table={<Table table={report.table} testId="report-group-table" />}
        />
      </Panel>
      <Panel title="Biggest wins" testId="closing-wins">
        {report.biggestWins.length === 0 ? (
          <p className="faint text-sm">No wins in this period yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--hairline-3)] text-sm">
            {report.biggestWins.map((win, index) => (
              <li key={index} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  {win.title}
                  <span className="faint block text-[0.7rem]">{win.rep}</span>
                </span>
                <span className="num shrink-0">{money(win.valueCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-[var(--border)] p-3">
            <p className="faint">Won before</p>
            <p className="num mt-1 text-base font-semibold">{money(report.previousWon.valueCents)}</p>
            <p className="faint">{report.previousWon.count} deals</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <p className="faint">Lost before</p>
            <p className="num mt-1 text-base font-semibold">{money(report.previousLost.valueCents)}</p>
            <p className="faint">{report.previousLost.count} deals</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------- Money ------------------------------- */

function MoneyView({ report, by }: { report: MoneyReport } & ViewProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Owed by how late it is" sub="Open amounts on signed paperwork, by days past their due date" testId="money-aging">
        <HBars rows={report.buckets.map((bucket) => ({ label: bucket.label, values: [bucket.cents] }))} series={["Owed"]} format="money" label="Money owed by age" />
        {report.creditCents < 0 && <p className="faint mt-2 text-xs">Credits from change orders take {money(-report.creditCents)} off the total.</p>}
      </Panel>
      <Panel title="Who owes the most" testId="money-debtors">
        {report.debtors.length === 0 ? (
          <p className="faint text-sm">Nobody owes anything right now.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="table text-xs" data-testid="money-debtor-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="text-right">Owed</th>
                  <th className="text-right">Past due</th>
                  <th className="text-right">Oldest due</th>
                </tr>
              </thead>
              <tbody>
                {report.debtors.map((row) => (
                  <tr key={row.id} data-testid="money-debtor-row">
                    <td className="font-medium">
                      <Link href={row.href} className="link">
                        {row.name}
                      </Link>
                    </td>
                    <td className="num text-right">{money(row.owedCents)}</td>
                    <td className={`num text-right ${row.overdueCents ? "text-[var(--danger)]" : ""}`}>{money(row.overdueCents)}</td>
                    <td className="num text-right">{row.oldestDue ? `${formatIsoDay(row.oldestDue)}${row.daysLate ? ` · ${row.daysLate}d late` : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Waiting on a signature" sub={`${report.unsigned.count} contracts sent and not signed · ${money(report.unsigned.valueCents)}`} testId="money-unsigned">
        {report.unsigned.oldest.length === 0 ? (
          <p className="faint text-sm">No contracts are waiting on a signature.</p>
        ) : (
          <ul className="divide-y divide-[var(--hairline-3)] text-sm">
            {report.unsigned.oldest.map((row) => (
              <li key={row.id} className="flex justify-between gap-3 py-2">
                <Link href={`/dashboard/contracts/${row.id}`} className="link min-w-0 truncate">
                  CON-{row.number} · {row.customer}
                </Link>
                <span className="num faint shrink-0 text-xs">
                  {row.days} days · {money(row.valueCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={`Owed by ${BREAKDOWN_LABELS[by].toLowerCase()}`} sub={by === "rep" ? "The rep on the deal the paperwork came from" : undefined} testId="money-groups">
        <ChartAndTable
          empty={report.groups.length === 0}
          chart={<HBars rows={report.groups.map((group) => ({ label: group.name, values: [group.owedCents] }))} series={["Owed"]} format="money" label={`Owed by ${BREAKDOWN_LABELS[by]}`} />}
          table={
            <Table
              testId="report-group-table"
              table={{
                title: "",
                columns: [
                  { label: BREAKDOWN_LABELS[by], format: "text" },
                  { label: "Owed", format: "money" },
                  { label: "Past due", format: "money" },
                ],
                rows: report.groups.map((group) => [group.name, group.owedCents, group.overdueCents]),
              }}
            />
          }
        />
      </Panel>
    </div>
  );
}
