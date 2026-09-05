import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { DEAL_STAGES, DEAL_STAGE_LABELS } from "@/lib/constants";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { IconTrending } from "@/components/icons";
import { StageSelect } from "./stage-select";

const STAGE_ACCENTS: Record<string, string> = {
  NEW: "#38bdf8",
  CONTACTED: "#fbbf24",
  WON: "#34d399",
  LOST: "#fb7185",
};

export default async function DealsPage() {
  const { organizationId } = await requireSession();

  const deals = await prisma.deal.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { id: true, name: true, company: true } } },
  });

  const openValue = deals
    .filter((deal) => deal.stage === "NEW" || deal.stage === "CONTACTED")
    .reduce((sum, deal) => sum + deal.valueCents, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Pipeline"
        subtitle={`${formatCents(openValue)} in open deals`}
      />

      {deals.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconTrending size={20} />}
            title="No deals yet"
            body="Deals are added from a contact's page — they track the work you're chasing before it becomes a quote."
            action={
              <Link href="/dashboard/contacts" className="btn btn-primary btn-sm">
                Go to contacts
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {DEAL_STAGES.map((stage) => {
            const stageDeals = deals.filter((deal) => deal.stage === stage);
            const stageValue = stageDeals.reduce(
              (sum, deal) => sum + deal.valueCents,
              0,
            );
            return (
              <div key={stage} className="card card-lit flex flex-col">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: STAGE_ACCENTS[stage],
                        boxShadow: `0 0 10px ${STAGE_ACCENTS[stage]}`,
                      }}
                    />
                    <h2 className="text-sm font-semibold">
                      {DEAL_STAGE_LABELS[stage]}
                    </h2>
                    <span className="faint num text-xs">{stageDeals.length}</span>
                  </div>
                  <span className="num text-xs font-medium">
                    {formatCents(stageValue)}
                  </span>
                </div>

                <div className="flex-1 space-y-2 p-3">
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
                        {deal.contact.company || deal.contact.name}
                      </Link>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="num text-xs font-medium">
                          {formatCents(deal.valueCents)}
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
      )}
    </div>
  );
}
