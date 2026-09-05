import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDateTime } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { ACTIVITY_LABELS, type ActivityTypeValue } from "@/lib/constants";
import { PageHeader, Card, CardHeader, StatTile, EmptyState } from "@/components/ui";
import {
  IconPlus,
  IconFileText,
  IconSignature,
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
} from "@/components/icons";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

export default async function DashboardPage() {
  const { organizationId, name } = await requireSession();

  const [
    contactCount,
    leadCount,
    openDeals,
    sentQuotes,
    awaitingSignature,
    signedCount,
    recentActivity,
  ] = await Promise.all([
    prisma.contact.count({ where: { organizationId } }),
    prisma.contact.count({ where: { organizationId, status: "LEAD" } }),
    prisma.deal.findMany({
      where: { organizationId, stage: { in: ["NEW", "CONTACTED"] } },
      select: { valueCents: true },
    }),
    prisma.quote.findMany({
      where: { organizationId, status: "SENT" },
      select: { lineItems: { select: { quantity: true, unitPriceCents: true, tag: true } } },
    }),
    prisma.contract.count({ where: { organizationId, status: "SENT" } }),
    prisma.contract.count({ where: { organizationId, status: "SIGNED" } }),
    prisma.activity.findMany({
      where: { organizationId },
      orderBy: { occurredAt: "desc" },
      take: 8,
      include: {
        contact: { select: { id: true, name: true, company: true } },
        user: { select: { name: true } },
      },
    }),
  ]);

  const openDealValue = openDeals.reduce((sum, deal) => sum + deal.valueCents, 0);
  const quotedValue = sentQuotes.reduce(
    (sum, quote) => sum + computeQuoteTotals(quote.lineItems).totalCents,
    0,
  );

  const firstName = name?.split(" ")[0] ?? "there";

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${firstName}`}
        subtitle="Where every open job stands right now."
        actions={
          <>
            <Link href="/dashboard/quotes/new" className="btn btn-ghost btn-sm">
              <IconFileText size={13} />
              New quote
            </Link>
            <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add contact
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Contacts" value={contactCount} hint={`${leadCount} open leads`} />
        <StatTile
          label="Open pipeline"
          value={formatCents(openDealValue)}
          hint={`${openDeals.length} active deals`}
          accent="#38bdf8"
        />
        <StatTile
          label="Quoted & sent"
          value={formatCents(quotedValue)}
          hint={`${sentQuotes.length} quotes out`}
          accent="#a78bfa"
        />
        <StatTile
          label="Awaiting signature"
          value={awaitingSignature}
          hint="Contracts sent"
          accent="#fbbf24"
        />
        <StatTile
          label="Signed"
          value={signedCount}
          hint="Contracts closed"
          accent="#34d399"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card lit className="lg:col-span-2">
          <CardHeader title="Recent activity" subtitle="Across every contact" />
          {recentActivity.length === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              body="Calls, texts, emails and meetings you log on a contact show up here."
            />
          ) : (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
              {recentActivity.map((activity) => {
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
                      <p className="truncate text-sm">{activity.body}</p>
                      <p className="faint mt-0.5 text-[0.7rem]">
                        <Link
                          href={`/dashboard/contacts/${activity.contact.id}`}
                          className="link"
                        >
                          {activity.contact.company || activity.contact.name}
                        </Link>{" "}
                        · {ACTIVITY_LABELS[activity.type as ActivityTypeValue]} ·{" "}
                        {formatDateTime(activity.occurredAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card lit>
          <CardHeader title="Jump in" />
          <div className="space-y-2 p-5">
            <Link href="/dashboard/products" className="nav-item">
              Manage product catalog
            </Link>
            <Link href="/dashboard/quotes/new" className="nav-item">
              Build a quote
            </Link>
            <Link href="/dashboard/contracts/templates" className="nav-item">
              Edit contract templates
            </Link>
            <Link href="/dashboard/contracts/new" className="nav-item">
              <IconSignature size={15} className="opacity-70" />
              Send a contract
            </Link>
            <Link href="/dashboard/settings" className="nav-item">
              Change branding
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
