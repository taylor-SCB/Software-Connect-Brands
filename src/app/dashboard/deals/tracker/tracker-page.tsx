import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getOrganization } from "@/lib/organization";
import { loadTrackerDeal, loadTrackerDeals, loadTrackerPickers } from "@/lib/tracker";
import { todayIso } from "@/lib/payments";
import { formatCents } from "@/lib/format";
import { contractHoldsRows } from "@/lib/contracts";
import { PageHeader, Card, CardHeader, EmptyState, StatusBadge, FormSuccess } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { IconClock, IconFileText } from "@/components/icons";
import { TrackerPicker } from "./tracker-picker";
import { TrackerGrid } from "./tracker-grid";
import { TrackerContracts } from "./tracker-contracts";

export type TrackerSearchParams = Promise<{ dealId?: string; quoteId?: string; created?: string }>;

// The Deal Tracker. Lives under Pipeline and under Contracts — same page,
// two addresses — so it is one click away from either side of the job.
// Blank until a deal is picked; then the split grid for its quote and
// the contracts already made from it.
export async function DealTrackerPage({
  searchParams,
  basePath,
}: {
  searchParams: TrackerSearchParams;
  basePath: "/dashboard/deals/tracker" | "/dashboard/contracts/tracker";
}) {
  const { organizationId } = await requireSession();
  const { dealId = "", quoteId = "", created } = await searchParams;
  const organization = await getOrganization();

  const [deals, deal, pickers] = await Promise.all([
    loadTrackerDeals(organizationId),
    dealId ? loadTrackerDeal(organizationId, dealId) : null,
    loadTrackerPickers(organizationId),
  ]);

  const quote =
    deal?.quotes.find((candidate) => candidate.id === quoteId) ??
    deal?.quotes.find((candidate) => candidate.id === deal.primaryQuoteId) ??
    deal?.quotes[0] ??
    null;

  const eyebrow = basePath.startsWith("/dashboard/deals") ? "Pipeline" : "Agreements";
  const openRows = quote
    ? quote.lineItems.filter((row) => !row.cancelled && row.onContracts.length === 0).length
    : 0;
  const standing = deal ? deal.contracts.filter((contract) => contractHoldsRows(contract.status)) : [];
  const awaiting = standing.filter((contract) => contract.status === "SENT").length;
  const outstandingCents = standing.reduce((sum, contract) => sum + contract.totalCents - contract.paidCents, 0);

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title="Deal Tracker"
        subtitle="Split a deal's quote into the contracts it needs — a Sales Order for the customer, a Purchase Order for the supplier — and track each one to signature and payment."
      />

      <Card lit className="mb-5">
        <div className="p-5">
          <TrackerPicker
            basePath={basePath}
            deals={deals}
            dealId={deal?.id ?? ""}
            quotes={deal?.quotes.map((q) => ({ id: q.id, number: q.number, title: q.title, status: q.status })) ?? []}
            quoteId={quote?.id ?? ""}
          />
        </div>
      </Card>

      {created && Number(created) > 0 && (
        <div className="mb-5">
          <FormSuccess message={`${created} ${Number(created) === 1 ? "contract" : "contracts"} created. They are drafts — open each one to review and send it.`} />
        </div>
      )}

      {!deal ? (
        <Card lit>
          <EmptyState
            icon={<IconClock size={20} />}
            title="Pick a deal to start"
            body="The grid shows the quote's rows down the side and a column for each contract you want to send. Nothing is created until you say so."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card lit>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <Avatar
                  url={deal.contact.company?.logoUrl ?? deal.contact.imageUrl}
                  name={deal.contact.company?.name ?? deal.contact.name}
                  size={44}
                />
                <div>
                  <p className="text-base font-semibold">{deal.title}</p>
                  <p className="muted text-sm">
                    {deal.contact.company ? (
                      <>
                        <Link href={`/dashboard/companies/${deal.contact.company.id}`} className="link">{deal.contact.company.name}</Link>
                        {" · "}
                      </>
                    ) : null}
                    <Link href={`/dashboard/contacts/${deal.contact.id}`} className="link">{deal.contact.name}</Link>
                    {" "}
                    <StatusBadge status={deal.stage} />
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <dt className="eyebrow">Open rows</dt>
                  <dd className="num text-lg font-semibold">{openRows}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Awaiting signature</dt>
                  <dd className="num text-lg font-semibold">{awaiting}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Outstanding</dt>
                  <dd className="num text-lg font-semibold">{formatCents(outstandingCents)}</dd>
                </div>
              </dl>
            </div>
          </Card>

          {!quote ? (
            <Card lit>
              <EmptyState
                icon={<IconFileText size={20} />}
                title="This deal has no quote yet"
                body="The tracker splits a quote's rows into contracts. Write the quote first."
                action={
                  <Link href={`/dashboard/quotes/new?contactId=${deal.contact.id}&dealId=${deal.id}`} className="btn btn-primary btn-sm">
                    New quote
                  </Link>
                }
              />
            </Card>
          ) : (
            <Card lit>
              <CardHeader
                title={`Split QUO-${quote.number} · ${quote.title}`}
                subtitle="Each column is one contract. Tick the rows that belong on it; a row can be on several. Untouched rows stay open on the deal."
                actions={
                  <Link href={`/dashboard/quotes/${quote.id}`} className="btn btn-ghost btn-sm">
                    <IconFileText size={13} />
                    Open quote
                  </Link>
                }
              />
              <div className="p-5">
                <TrackerGrid
                  key={quote.id}
                  dealId={deal.id}
                  quote={quote}
                  dealContact={{ id: deal.contact.id, companyId: deal.contact.companyId }}
                  pickers={pickers}
                  today={todayIso(organization.timeZone)}
                  returnTo={basePath}
                />
              </div>
            </Card>
          )}

          <Card lit>
            <CardHeader
              title="Contracts on this deal"
              subtitle="Sent and signed dates, totals, payments and reminders. Reminders are copied for you to text or email — nothing is sent from the app yet."
            />
            <TrackerContracts
              contracts={deal.contracts}
              organizationName={organization.name}
              timeZone={organization.timeZone}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
