import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getOrganization } from "@/lib/organization";
import { loadTrackerDeal, loadTrackerDeals, loadTrackerPickers } from "@/lib/tracker";
import { todayIso } from "@/lib/payments";
import { formatCents, formatDate } from "@/lib/format";
import { AwardWithoutPaperwork } from "@/app/dashboard/projects/award-without-paperwork";
import { contractHoldsRows } from "@/lib/contracts";
import { PageHeader, Card, CardHeader, EmptyState, StatusBadge, FormSuccess } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { IconClock, IconFileText, IconHardHat } from "@/components/icons";
import { TrackerPicker } from "./tracker-picker";
import { TrackerGrid } from "./tracker-grid";
import { TrackerContracts } from "./tracker-contracts";

export type TrackerSearchParams = Promise<{ dealId?: string; quoteId?: string; created?: string }>;

// The Contract Coordinator. Lives under Pipeline and under Contracts — same page,
// two addresses — so it is one click away from either side of the job.
// Blank until a deal is picked; then the deal's numbers, its job (or the
// way to award one), the split grid for its quote and the contracts
// already made from it.
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
  // What the customer still owes on this deal. Money-out purchase orders
  // are what we owe a supplier, so they are not part of it.
  const incoming = standing.filter((contract) => !contract.payable);
  const outstandingCents = incoming.reduce((sum, contract) => sum + contract.totalCents - contract.paidCents, 0);
  // The part of it they have already signed for — the same number their
  // company row shows as "Owes you".
  const signedOwedCents = incoming
    .filter((contract) => contract.status === "SIGNED")
    .reduce((sum, contract) => sum + contract.totalCents - contract.paidCents, 0);
  const today = todayIso(organization.timeZone);

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title="Contract Coordinator"
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
            body="The quote's rows run across the top with a tick column for each contract you want to send; each contract is a card below. Nothing is created until you say so."
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
              <dl className="grid grid-cols-3 gap-6 text-center">
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
                  <dd className="num text-lg font-semibold" data-testid="tracker-outstanding">{formatCents(outstandingCents)}</dd>
                  <dd className="faint num text-xs" data-testid="tracker-signed-owed">Signed: {formatCents(signedOwedCents)}</dd>
                </div>
              </dl>
            </div>
          </Card>

          {/* The job this deal is, or the way to make it one. Its own card,
              in plain words, so a handshake win is never hunted for. */}
          <Card lit>
            {deal.project ? (
              <div className="flex flex-wrap items-center justify-between gap-4 p-5" data-testid="job-card">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)", color: "var(--brand)" }}
                  >
                    <IconHardHat size={20} />
                  </div>
                  <div>
                    <p className="eyebrow">Job</p>
                    <p className="text-base font-semibold">
                      <Link href={`/dashboard/projects/${deal.project.id}`} className="link num" data-testid="tracker-project">
                        PRJ-{deal.project.number}
                      </Link>
                      {" · "}
                      {deal.project.name} <StatusBadge status={deal.project.stage} />
                    </p>
                    <p className="faint text-xs">
                      Awarded {formatDate(deal.project.awardedAt, organization.timeZone)}. New paperwork made here lands on this job.
                    </p>
                  </div>
                </div>
                <Link href={`/dashboard/projects/${deal.project.id}`} className="btn btn-ghost btn-sm">
                  <IconHardHat size={13} />
                  Open the job
                </Link>
              </div>
            ) : (
              <AwardWithoutPaperwork
                key={quote?.id ?? "none"}
                dealId={deal.id}
                today={today}
                defaults={pickers.paymentDefaults}
                quote={
                  quote
                    ? {
                        id: quote.id,
                        number: quote.number,
                        paymentTerms: quote.paymentTerms,
                        payments: quote.payments,
                        lineItems: quote.lineItems.map((row) => ({
                          id: row.id,
                          name: row.name,
                          quantity: row.quantity,
                          unitPriceCents: row.unitPriceCents,
                          discountCents: row.discountCents,
                          tag: row.tag,
                          cancelled: row.cancelled,
                        })),
                      }
                    : null
                }
              />
            )}
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
                subtitle="Tick each row under the contract it belongs on — a row can be on several — then fill in each contract's card below. Untouched rows stay open on the deal."
                actions={
                  <Link href={`/dashboard/quotes/${quote.id}`} className="btn btn-ghost btn-sm">
                    <IconFileText size={13} />
                    Open quote
                  </Link>
                }
              />
              <div className="p-5">
                {/* Keyed on the contract count too: creating contracts lands
                    back here with the rows now on paperwork, and the grid
                    must start clean rather than keep the ticks that would
                    make the same contracts again on a second click. */}
                <TrackerGrid
                  key={`${quote.id}:${deal.contracts.length}`}
                  dealId={deal.id}
                  quote={quote}
                  dealContact={{ id: deal.contact.id, companyId: deal.contact.companyId }}
                  pickers={pickers}
                  today={today}
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
