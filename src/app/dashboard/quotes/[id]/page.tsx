import Link from "next/link";
import { STARRED_MINIMUM_SELECT, starredMinimumCents } from "@/lib/supplier-math";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getServiceTypes } from "@/lib/service-types";
import { loadDistributorCompanies } from "@/lib/distributors";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate } from "@/lib/format";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
  DealStageBadge,
} from "@/components/ui";
import { IconExternal, IconDownload, IconClock } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { LineItemsEditor } from "./line-items-editor";
import { SendQuoteButton, QuoteUnsavedProvider } from "./mark-sent";
import { DealJourney } from "@/components/deal-journey";
import { loadDealJourney } from "@/lib/deal-journey-load";
import { JourneyNext } from "@/app/dashboard/contracts/journey-next";
import { DeleteQuoteButton } from "./delete-quote";
import { loadPlatformSuppliers } from "@/lib/platform-suppliers";
import { QuoteSaveBar, QuoteSaveProvider } from "./quote-save";
import { QuotePaymentTable } from "./quote-payment-table";
import { QuoteMetaForm } from "./quote-meta-form";
import { dateToIso, todayIso, quoteBaselineRows } from "@/lib/payments";
import { computeQuoteTotals } from "@/lib/quote-math";
import { setQuoteStatus } from "../actions";
import { lineLabelsFor } from "@/lib/line-labels";
import { getCustomUnits } from "@/lib/variations";
import { readSnapshot } from "@/lib/variation-shared";
import { aiConfigured } from "@/lib/ai";

// yyyy-mm-dd for <input type="date">, which only accepts that shape.
function toDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function QuoteBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { id } = await params;
  const { draft: draftParam } = await searchParams;
  const { organizationId } = await requireSession();

  const timeZone = await getTimeZone();

  // The catalog isn't loaded here: the "Add from catalog" box searches it
  // (/dashboard/products/search), so a quote opens as fast with fifty
  // thousand products as with five.
  const [quote, serviceTypes] = await Promise.all([
    prisma.quote.findFirst({
      where: { id, organizationId },
      include: {
        contact: { select: { id: true, name: true, email: true, phone: true, mobile: true, company: { select: { name: true } } } },
        deal: { select: { id: true, title: true, stage: true } },
        lineItems: {
          orderBy: { position: "asc" },
          include: {
            product: { select: { suppliers: STARRED_MINIMUM_SELECT } },
            image: { select: { publicToken: true, removedAt: true } },
          },
        },
        payments: { orderBy: { position: "asc" } },
      },
    }),
    getServiceTypes(organizationId),
  ]);

  if (!quote) notFound();

  const [users, journey] = await Promise.all([
    loadWorkspaceUsers(organizationId),
    loadDealJourney(organizationId, timeZone, { dealId: quote.dealId, quoteId: quote.id, page: "quote" }),
  ]);

  // "Draft lines from the meeting" (Nov 10, 2026): AI on, a draft, and a
  // deal that came from a Pipeline opportunity. Build Quote can ask for it
  // to run on arrival (?draft=meeting), and only while the quote has no
  // lines, so coming back to that address never drafts on top of saved
  // ones.
  const fromOpportunity =
    aiConfigured() && quote.status === "DRAFT"
      ? await prisma.opportunity.findFirst({ where: { organizationId, dealId: quote.dealId }, select: { id: true } })
      : null;

  // Suppliers already on a line are fetched back even if they have since
  // stopped being distributors, so the picker can offer the linked one.
  const [suppliers, platformSuppliers, productLabels, units] = await Promise.all([
    loadDistributorCompanies(
      organizationId,
      quote.lineItems
        .map((item) => item.supplierCompanyId)
        .filter((value): value is string => Boolean(value)),
    ),
    loadPlatformSuppliers(organizationId),
    // Release 3b: the labels and pictures of the products on the quote, in
    // one go, and the workspace's own units (plus any a line still has).
    lineLabelsFor(
      organizationId,
      quote.lineItems.flatMap((item) => (item.productId ? [item.productId] : [])),
    ),
    getCustomUnits(
      organizationId,
      quote.lineItems.map((item) => item.customUnitId),
    ),
  ]);

  const publicPath = `/q/${quote.publicToken}`;
  const today = todayIso(timeZone);
  const quoteTotalCents = computeQuoteTotals(quote.lineItems, quote).totalCents;
  const sendQuote = (
    <SendQuoteButton
      quoteId={quote.id}
      quoteLabel={`QUO-${quote.number} ${quote.title}`}
      publicPath={publicPath}
      contact={{ name: quote.contact.name, email: quote.contact.email, phone: quote.contact.mobile || quote.contact.phone }}
    />
  );

  return (
    // Send quote (under the strip) waits while the Line items card has
    // unsaved edits, so the provider holds both.
    <QuoteUnsavedProvider>
      <QuoteSaveProvider>
      {/* Room at the foot of a phone for the strip's pinned Next button. */}
      <div className={journey?.journey.next ? "max-sm:pb-24" : undefined}>
      <BackLink href="/dashboard/quotes" label="Quotes" current={`QUO-${quote.number} ${quote.title}`} />

      <PageHeader
        eyebrow={`QUO-${quote.number} · ${quote.deal.title} · ${quote.contact.company?.name || quote.contact.name}`}
        title={quote.title}
        actions={
          <>
            <Link
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconExternal size={13} />
              Preview
            </Link>
            <a href={`${publicPath}/pdf`} className="btn btn-ghost btn-sm">
              <IconDownload size={13} />
              PDF
            </a>
            <Link
              href={`/dashboard/contracts/tracker?dealId=${quote.deal.id}&quoteId=${quote.id}`}
              className="btn btn-ghost btn-sm"
              data-testid="split-into-contracts"
            >
              <IconClock size={13} />
              Split into contracts
            </Link>
            {quote.status === "DRAFT" ? (
              // The strip's Next is Send quote while this is the step; on
              // a later quote of a deal further along, it sits here.
              journey?.journey.next?.key !== "send-quote" && sendQuote
            ) : (
              <form action={setQuoteStatus}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="status" value="DRAFT" />
                <button type="submit" className="btn btn-ghost btn-sm">
                  Back to draft
                </button>
              </form>
            )}
          </>
        }
      />

      {journey && (
        <div className="mb-5">
          <DealJourney
            journey={journey.journey}
            stickyNext
            next={<JourneyNext next={journey.journey.next} refs={journey.refs} page="quote" here={{ "send-quote": sendQuote }} />}
            details={
              <>
                <StatusBadge status={quote.status} />
                <span className="faint text-xs">Deal</span>
                <DealStageBadge stage={quote.deal.stage} />
                {quote.sentAt && <span className="faint text-xs">Sent {formatDate(quote.sentAt, timeZone)}</span>}
                {quote.status === "ACCEPTED" && quote.acceptedByName && (
                  <span className="faint text-xs" data-testid="quote-accepted-by">
                    Accepted online by {quote.acceptedByName}
                    {quote.respondedAt ? ` · ${formatDate(quote.respondedAt, timeZone)}` : ""}
                  </span>
                )}
              </>
            }
          />
        </div>
      )}

      {quote.status !== "DRAFT" && (
        <Card className="mb-5 p-4">
          <p className="eyebrow mb-2">Customer link</p>
          <PublicLinkField path={publicPath} />
          <p className="faint mt-2 text-xs">
            Anyone with this link can view the quote — send it by email or text.
            {quote.sentAt && ` Marked sent ${formatDate(quote.sentAt, timeZone)}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={setQuoteStatus}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="status" value="ACCEPTED" />
              <button type="submit" className="btn btn-ghost btn-sm">
                Mark accepted
              </button>
            </form>
            <form action={setQuoteStatus}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <input type="hidden" name="status" value="DECLINED" />
              <button type="submit" className="btn btn-ghost btn-sm">
                Mark declined
              </button>
            </form>
          </div>
        </Card>
      )}

      <div className="space-y-5">
        {/* Above the cards after it: every card is its own layer (the glass
            blur), so the Add from catalog list opening downward was drawn
            under the Payment table and lost its taps there. */}
        <Card lit className="z-20">
          <CardHeader
            title="Line items"
            subtitle="Each line carries a product description, project-specific notes and a tag."
          />
          <LineItemsEditor
            quoteId={quote.id}
            initialLines={quote.lineItems.map((item) => ({
              id: item.id,
              productId: item.productId,
              name: item.name,
              description: item.description,
              projectNotes: item.projectNotes,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              discountCents: item.discountCents,
              discountPercent: item.discountPercent,
              tag: item.tag,
              serviceType: item.serviceType,
              supplierCompanyId: item.supplierCompanyId,
              unitOfMeasure: item.unitOfMeasure,
              softwareRate: item.softwareRate,
              softwareTermMonths: item.softwareTermMonths,
              minPriceCents: item.product ? starredMinimumCents(item.product.suppliers) : null,
              variations: readSnapshot(item.variations),
              customUnitId: item.customUnitId,
              unitLabel: item.unitLabel,
              imageId: item.imageId,
              imageToken: item.image?.publicToken ?? null,
              imageRemoved: Boolean(item.image?.removedAt),
            }))}
            productLabels={productLabels}
            units={units.map((unit) => ({ id: unit.id, name: unit.name, tag: unit.tag, archived: unit.archived }))}
            draft={quote.status === "DRAFT"}
            initialDiscount={{ discountCents: quote.discountCents, discountPercent: quote.discountPercent }}
            serviceTypes={serviceTypes}
            suppliers={suppliers}
            platformSuppliers={platformSuppliers}
            meetingDraft={fromOpportunity ? { auto: draftParam === "meeting" && quote.lineItems.length === 0 } : null}
          />
        </Card>

        <Card lit>
          <CardHeader
            title="Payment table"
            subtitle="Percent of the total or a fixed amount, with a term and a date. It prices against the lines as last saved, so save those first."
          />
          <QuotePaymentTable
            quoteId={quote.id}
            totalCents={quoteTotalCents}
            paymentTerms={quote.paymentTerms ?? ""}
            hidePaymentTable={quote.hidePaymentTable}
            today={today}
            unsaved={quote.payments.length === 0}
            initialRows={
              // Nothing is written on a page load: an empty table starts
              // from the baseline unsaved, so it is there to edit but only
              // exists once someone saves it.
              quote.payments.length > 0
                ? quote.payments.map((payment) => ({
                    id: payment.id,
                    label: payment.label,
                    kind: payment.kind,
                    percent: payment.percent,
                    amountCents: payment.amountCents,
                    dueOn: dateToIso(payment.dueOn),
                    terms: payment.terms ?? "",
                  }))
                : quoteBaselineRows().map((row) => ({
                    label: row.label,
                    kind: row.kind,
                    percent: row.percent,
                    amountCents: 0,
                    dueOn: row.dueOn,
                    terms: row.terms ?? "",
                  }))
            }
          />
        </Card>

        <Card lit>
          <CardHeader title="Quote details" />
          <QuoteMetaForm
            quoteId={quote.id}
            users={users}
            defaults={{
              title: quote.title,
              template: quote.template,
              introNote: quote.introNote,
              terms: quote.terms,
              validUntil: toDateInput(quote.validUntil),
              leadSalesRepId: quote.leadSalesRepId ?? "",
              contractSignerId: quote.contractSignerId ?? "",
              teamUserIds: quote.teamUserIds,
            }}
          />
        </Card>

        <Card className="border-[rgb(251_113_133/0.25)]">
          <CardHeader title="Danger zone" subtitle="Deleting a quote can't be undone." />
          <DeleteQuoteButton
            quoteId={quote.id}
            question={
              quote.status === "DRAFT"
                ? `Delete QUO-${quote.number} for good?`
                : `Delete QUO-${quote.number} for good? The customer's link stops working.`
            }
          />
        </Card>
      </div>
      {/* The one Save for the cards above (a phone uses the Line items
          card's pinned bar, which saves the same). */}
      <QuoteSaveBar />
      </div>
      </QuoteSaveProvider>
    </QuoteUnsavedProvider>
  );
}
