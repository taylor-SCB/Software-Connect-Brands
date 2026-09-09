import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { DEAL_STAGES, DEAL_STAGE_LABELS, DEAL_STAGE_COLORS } from "@/lib/constants";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { IconTrending, IconFileText, IconPlus } from "@/components/icons";
import { StageSelect } from "./stage-select";

export default async function DealsPage() {
  const { organizationId } = await requireSession();

  const deals = await prisma.deal.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      contact: { select: { id: true, name: true, company: { select: { name: true } } } },
      quotes: {
        select: { ...QUOTES_FOR_VALUE.select, id: true, number: true, title: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const openValue = deals
    .filter((deal) => isOpenStage(deal.stage))
    .reduce((sum, deal) => sum + dealValueCents(deal), 0);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Pipeline"
        subtitle={`${formatCents(openValue)} in open deals · a deal's value comes from its quotes`}
        actions={
          <Link href="/dashboard/quotes/new" className="btn btn-primary btn-sm">
            <IconPlus size={14} />
            New quote
          </Link>
        }
      />

      {deals.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconTrending size={20} />}
            title="No deals yet"
            body="A deal is one job you're trying to win. Start one from a contact's page, or just create a quote — every quote lives on a deal."
            action={
              <Link href="/dashboard/contacts" className="btn btn-primary btn-sm">
                Go to contacts
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
          <div className="grid min-w-[1240px] grid-cols-6 gap-3">
            {DEAL_STAGES.map((stage) => {
              const stageDeals = deals.filter((deal) => deal.stage === stage);
              const stageValue = stageDeals.reduce(
                (sum, deal) => sum + dealValueCents(deal),
                0,
              );
              const accent = DEAL_STAGE_COLORS[stage];
              return (
                <div key={stage} className="card card-lit flex flex-col">
                  <div className="border-b border-[var(--border)] px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
                      />
                      <h2 className="whitespace-nowrap text-sm font-semibold">
                        {DEAL_STAGE_LABELS[stage]}
                      </h2>
                      <span className="faint num text-xs">{stageDeals.length}</span>
                    </div>
                    <p className="num faint mt-1 pl-4 text-xs">{formatCents(stageValue)}</p>
                  </div>

                  <div className="flex-1 space-y-2 p-2.5">
                    {stageDeals.length === 0 && (
                      <p className="faint py-4 text-center text-xs">No deals</p>
                    )}
                    {stageDeals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3"
                      >
                        <p className="text-sm font-medium">{deal.title}</p>
                        <Link
                          href={`/dashboard/contacts/${deal.contact.id}`}
                          className="link text-xs"
                        >
                          {deal.contact.company?.name
                            ? `${deal.contact.company.name} · ${deal.contact.name}`
                            : deal.contact.name}
                        </Link>
                        {deal.quotes.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {deal.quotes.map((quote) => (
                              <li key={quote.id}>
                                <Link
                                  href={`/dashboard/quotes/${quote.id}`}
                                  className="faint flex max-w-full items-center gap-1 text-[0.7rem] hover:text-[var(--text)]"
                                >
                                  <IconFileText size={11} className="shrink-0" />
                                  <span className="num shrink-0 whitespace-nowrap">QUO-{quote.number}</span>
                                  <span className="truncate">{quote.title}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <span className="num text-xs font-medium">
                            {formatCents(dealValueCents(deal))}
                          </span>
                          <StageSelect dealId={deal.id} stage={deal.stage} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
