import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { PageHeader, Card, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { IconPlus, IconFileText } from "@/components/icons";

export default async function QuotesPage() {
  const { organizationId } = await requireSession();

  const quotes = await prisma.quote.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, name: true, company: true } },
      lineItems: { select: { quantity: true, unitPriceCents: true, tag: true } },
    },
  });

  const pipelineCents = quotes
    .filter((quote) => quote.status === "SENT")
    .reduce((sum, quote) => sum + computeQuoteTotals(quote.lineItems).totalCents, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Quotes"
        subtitle={
          pipelineCents > 0
            ? `${formatCents(pipelineCents)} out with customers`
            : "Build a quote from your product catalog."
        }
        actions={
          <Link href="/dashboard/quotes/new" className="btn btn-primary btn-sm">
            <IconPlus size={14} />
            New quote
          </Link>
        }
      />

      <Card lit>
        {quotes.length === 0 ? (
          <EmptyState
            icon={<IconFileText size={20} />}
            title="No quotes yet"
            body="Pick a contact, choose the Simple or Modern template, then drop in line items from your catalog."
            action={
              <Link href="/dashboard/quotes/new" className="btn btn-primary btn-sm">
                <IconPlus size={14} />
                New quote
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Customer</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => {
                  const totals = computeQuoteTotals(quote.lineItems);
                  return (
                    <tr key={quote.id}>
                      <td className="num faint text-xs">QUO-{quote.number}</td>
                      <td>
                        <Link
                          href={`/dashboard/quotes/${quote.id}`}
                          className="font-medium hover:underline"
                        >
                          {quote.title}
                        </Link>
                        <p className="faint text-xs">
                          {quote.lineItems.length}{" "}
                          {quote.lineItems.length === 1 ? "line" : "lines"}
                        </p>
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/contacts/${quote.contact.id}`}
                          className="link"
                        >
                          {quote.contact.company || quote.contact.name}
                        </Link>
                      </td>
                      <td>
                        <Badge>{quote.template === "MODERN" ? "Modern" : "Simple"}</Badge>
                      </td>
                      <td>
                        <StatusBadge status={quote.status} />
                      </td>
                      <td className="num text-right font-medium">
                        {formatCents(totals.totalCents)}
                      </td>
                      <td className="faint text-xs">{formatDate(quote.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
