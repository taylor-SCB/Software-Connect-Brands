import Link from "next/link";
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
} from "@/components/ui";
import { IconTrash, IconSend, IconExternal, IconDownload, IconClock } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { LineItemsEditor } from "./line-items-editor";
import { QuotePaymentTable } from "./quote-payment-table";
import { QuoteMetaForm } from "./quote-meta-form";
import { dateToIso, todayIso, quoteBaselineRows } from "@/lib/payments";
import { computeQuoteTotals } from "@/lib/quote-math";
import { setQuoteStatus, deleteQuote } from "../actions";

// yyyy-mm-dd for <input type="date">, which only accepts that shape.
function toDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const timeZone = await getTimeZone();

  const [quote, products, serviceTypes] = await Promise.all([
    prisma.quote.findFirst({
      where: { id, organizationId },
      include: {
        contact: { select: { id: true, name: true, company: { select: { name: true } } } },
        deal: { select: { id: true, title: true, stage: true } },
        lineItems: { orderBy: { position: "asc" } },
        payments: { orderBy: { position: "asc" } },
      },
    }),
    prisma.product.findMany({
      where: { organizationId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        unitPriceCents: true,
        defaultTag: true,
        serviceType: true,
        unitOfMeasure: true,
        softwareRate: true,
        softwareTerm: true,
      },
    }),
    getServiceTypes(organizationId),
  ]);

  const users = await loadWorkspaceUsers(organizationId);

  if (!quote) notFound();

  // Suppliers already on a line are fetched back even if they have since
  // stopped being distributors, so the picker can offer the linked one.
  const suppliers = await loadDistributorCompanies(
    organizationId,
    quote.lineItems
      .map((item) => item.supplierCompanyId)
      .filter((value): value is string => Boolean(value)),
  );

  const publicPath = `/q/${quote.publicToken}`;
  const today = todayIso(timeZone);
  const quoteTotalCents = computeQuoteTotals(quote.lineItems).totalCents;

  return (
    <div>
      <BackLink href="/dashboard/quotes" label="Quotes" current={`QUO-${quote.number} ${quote.title}`} />

      <PageHeader
        eyebrow={`QUO-${quote.number} · ${quote.deal.title} · ${quote.contact.company?.name || quote.contact.name}`}
        title={quote.title}
        actions={
          <>
            <StatusBadge status={quote.status} />
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
              <form action={setQuoteStatus}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="status" value="SENT" />
                <button type="submit" className="btn btn-primary btn-sm">
                  <IconSend size={13} />
                  Mark as sent
                </button>
              </form>
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
        <Card lit>
          <CardHeader
            title="Line items"
            subtitle="Each line carries a product description, project-specific notes and a tag."
          />
          <LineItemsEditor
            quoteId={quote.id}
            products={products}
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
            }))}
            serviceTypes={serviceTypes}
            suppliers={suppliers}
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
          <form action={deleteQuote} className="p-5">
            <input type="hidden" name="quoteId" value={quote.id} />
            <button type="submit" className="btn btn-danger btn-sm">
              <IconTrash size={13} />
              Delete quote
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
