import { contractTotalCents } from "@/lib/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { paidCentsOf } from "@/lib/money";
import { PageHeader, Card, CardHeader, StatTile, StatusBadge, Badge, EmptyState } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconFileText } from "@/components/icons";
import { ProjectTabs } from "../project-tabs";
import { InvoiceRow } from "./invoice-row";
import { OrderMaterials } from "./order-materials";
import { ChangeOrderForm } from "./change-order-form";
import { materialsToOrder } from "../../actions";
import { aiConfigured } from "@/lib/ai";
import { fileUrl } from "@/lib/uploads";
import { distributorTypeName } from "@/lib/distributors";
import { AddReceipt, PendingReceipts, type PendingReceipt } from "./receipts";

export default async function ProjectMoneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, role } = await requireSession();
  const { id } = await params;
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      companyId: true,
      contactId: true,
      billedCents: true,
      receivedCents: true,
      spentCents: true,
      committedCents: true,
      scopes: { orderBy: { position: "asc" }, select: { id: true, name: true, isDefault: true } },
      contracts: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          type: true,
          status: true,
          payable: true,
          signedAt: true,
          amendsContractId: true,
          amends: { select: { number: true } },
          company: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true } },
          discountCents: true,
          lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true } },
          payments: {
            orderBy: [{ dueOn: "asc" }, { position: "asc" }],
            select: {
              id: true,
              label: true,
              amountCents: true,
              dueOn: true,
              paidAt: true,
              invoiceNumber: true,
              invoiceToken: true,
              issuedAt: true,
              reference: true,
              payments: {
                orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
                select: { id: true, amountCents: true, paidOn: true, method: true, reference: true, note: true },
              },
            },
          },
        },
      },
    },
  });
  if (!project) notFound();

  const suppliers = await materialsToOrder(project.id);

  // Release C (C5): receipts. Those sent through the crew link wait here,
  // counting nowhere, until an Owner or Admin approves one. The store box
  // offers the workspace's suppliers.
  const supplierType = await distributorTypeName(organizationId);
  const [pendingRows, supplierCompanies] = await Promise.all([
    prisma.jobReceipt.findMany({
      where: { organizationId, projectId: project.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        storeName: true,
        purchasedOn: true,
        totalCents: true,
        taxCents: true,
        items: true,
        aiRead: true,
        sentByName: true,
        createdAt: true,
        upload: { select: { publicToken: true } },
      },
    }),
    prisma.company.findMany({
      where: { organizationId, companyTypes: { has: supplierType } },
      orderBy: { name: "asc" },
      take: 300,
      select: { name: true },
    }),
  ]);
  const pending: PendingReceipt[] = pendingRows.map((row) => ({
    id: row.id,
    photoSrc: row.upload ? fileUrl(row.upload.publicToken) : null,
    sentBy: row.sentByName ?? "Someone",
    sentOn: formatDate(row.createdAt, timeZone),
    storeName: row.storeName,
    purchasedOn: row.purchasedOn ? row.purchasedOn.toISOString().slice(0, 10) : null,
    totalCents: row.totalCents,
    taxCents: row.taxCents,
    items: Array.isArray(row.items) ? (row.items as PendingReceipt["items"]) : [],
    aiRead: row.aiRead,
  }));
  const supplierNames = supplierCompanies.map((company) => company.name);

  // What the customer owes: the rows on their signed paperwork.
  const incoming = project.contracts.filter((contract) => !contract.payable && contract.status === "SIGNED");
  // The rows to chase are the positive ones; a credit from a change
  // order shows under Change orders instead, and comes off the total.
  const owedRows = incoming.flatMap((contract) =>
    contract.payments
      .filter((row) => row.amountCents > 0)
      .map((row) => ({ row, contract })),
  );
  const owedCents = incoming.reduce(
    (sum, contract) =>
      sum + contract.payments.reduce((rows, row) => rows + row.amountCents - paidCentsOf(row), 0),
    0,
  );
  const overdue = owedRows.filter(
    (entry) => !entry.row.paidAt && entry.row.dueOn && entry.row.dueOn.toISOString().slice(0, 10) < today,
  ).length;

  // What we owe suppliers, grouped by who.
  const outgoing = project.contracts.filter(
    (contract) => contract.payable && (contract.status === "SENT" || contract.status === "SIGNED" || contract.status === "DRAFT"),
  );
  const bySupplier = new Map<string, { name: string; companyId: string | null; contracts: typeof outgoing }>();
  for (const contract of outgoing) {
    const key = contract.company?.id ?? contract.contact.id;
    const entry = bySupplier.get(key) ?? {
      name: contract.company?.name ?? contract.contact.name,
      companyId: contract.company?.id ?? null,
      contracts: [],
    };
    entry.contracts.push(contract);
    bySupplier.set(key, entry);
  }
  const weOweCents = outgoing
    .filter((contract) => contract.status !== "DRAFT")
    .reduce(
      (sum, contract) =>
        sum +
        contract.payments.reduce((rows, row) => rows + Math.max(0, row.amountCents) - paidCentsOf(row), 0),
      0,
    );

  const changeOrders = project.contracts.filter((contract) => contract.type === "Change Order");
  const scopeChoices = project.scopes.map((scope) => ({ id: scope.id, name: scope.name }));

  return (
    <div>
      <BackLink href={`/dashboard/projects/${project.id}`} label={project.name} />

      <PageHeader
        eyebrow={`Job · PRJ-${project.number}`}
        title="Money"
        subtitle={`${project.name} · ${project.customerName}`}
        actions={<StatusBadge status={project.stage} />}
      />

      <ProjectTabs projectId={project.id} current="money" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Owes you"
          value={formatCents(owedCents)}
          hint={overdue > 0 ? `${overdue} past due` : "On signed paperwork"}
          accent={overdue > 0 ? "#f87171" : "#34d399"}
        />
        <StatTile label="Collected" value={formatCents(project.receivedCents)} hint="Come in so far" />
        <StatTile
          label="You owe"
          value={formatCents(weOweCents)}
          hint="Orders out to suppliers"
          accent="#a78bfa"
        />
        <StatTile label="Paid out" value={formatCents(project.spentCents)} hint="On this job" accent="#fbbf24" />
      </div>

      <div className="space-y-5">
        <Card lit>
          <CardHeader
            title="Owes you"
            subtitle="Every payment on the paperwork they signed. Send one as an invoice when you want to chase it."
          />
          {owedRows.length === 0 ? (
            <EmptyState
              icon={<IconFileText size={20} />}
              title="Nothing billed yet"
              body="Rows appear here once the customer signs an agreement with a payment table on it."
            />
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {owedRows.map(({ row, contract }) => (
                <InvoiceRow
                  key={row.id}
                  row={{
                    id: row.id,
                    label: row.label,
                    amountCents: row.amountCents,
                    receivedCents: paidCentsOf(row),
                    dueOn: row.dueOn ? row.dueOn.toISOString().slice(0, 10) : null,
                    settled: Boolean(row.paidAt),
                    invoiceNumber: row.invoiceNumber,
                    invoiceToken: row.invoiceToken,
                    payments: row.payments.map((payment) => ({
                      id: payment.id,
                      amountCents: payment.amountCents,
                      paidOn: payment.paidOn.toISOString().slice(0, 10),
                      method: payment.method,
                      reference: payment.reference,
                      note: payment.note,
                    })),
                  }}
                  contract={{ id: contract.id, number: contract.number, type: contract.type }}
                  today={today}
                  timeZone={timeZone}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card lit>
          <CardHeader
            title="You owe"
            subtitle="Purchase orders out to suppliers, and what is still open on them."
            actions={<OrderMaterials projectId={project.id} suppliers={suppliers} />}
          />
          {bySupplier.size === 0 ? (
            <EmptyState
              icon={<IconFileText size={20} />}
              title="Nothing ordered yet"
              body={
                suppliers.length > 0
                  ? "Order materials above, and the purchase order lands here."
                  : "Purchase orders you send for this job show here. Materials with a distributor on the product can be ordered in one tap."
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {Array.from(bySupplier.entries()).map(([key, supplier]) => (
                <li key={key} className="px-5 py-3" data-testid="supplier-group">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      {supplier.companyId ? (
                        <Link href={`/dashboard/companies/${supplier.companyId}`} className="link">
                          {supplier.name}
                        </Link>
                      ) : (
                        supplier.name
                      )}
                    </p>
                    <span className="num text-sm font-medium">
                      {formatCents(
                        supplier.contracts
                          .filter((contract) => contract.status !== "DRAFT")
                          .reduce(
                            (sum, contract) =>
                              sum +
                              contract.payments.reduce(
                                (rows, row) => rows + Math.max(0, row.amountCents) - paidCentsOf(row),
                                0,
                              ),
                            0,
                          ),
                      )}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-1">
                    {supplier.contracts.map((contract) => {
                      const rowsTotal = contract.payments.reduce(
                        (sum, row) => sum + Math.max(0, row.amountCents),
                        0,
                      );
                      const paid = contract.payments.reduce((sum, row) => sum + paidCentsOf(row), 0);
                      return (
                        <li key={contract.id} className="faint num text-xs" data-testid="bill-row">
                          <Link href={`/dashboard/contracts/${contract.id}`} className="link">
                            CON-{contract.number}
                          </Link>
                          {" · "}
                          {contract.title}
                          {" · "}
                          <StatusBadge status={contract.status} />
                          {" "}
                          {formatCents(paid)} of {formatCents(rowsTotal)} paid
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card lit>
          <CardHeader
            title="Receipts"
            subtitle="Snap a receipt from the store: it becomes a paid bill on the scope you pick and counts in Spent."
            actions={
              <AddReceipt projectId={project.id} scopes={scopeChoices} suppliers={supplierNames} aiOn={aiConfigured()} today={today} />
            }
          />
          {pending.length > 0 ? (
            <>
              <p className="eyebrow px-5 pt-4" data-testid="pending-receipts-title">
                Receipts waiting for approval · {pending.length}
              </p>
              <p className="faint px-5 text-xs">Sent through the crew photo link. They don&apos;t count anywhere until approved.</p>
              <PendingReceipts receipts={pending} scopes={scopeChoices} suppliers={supplierNames} canApprove={role === "OWNER" || role === "ADMIN"} today={today} />
            </>
          ) : (
            <p className="faint px-5 py-4 text-xs">Receipts your crew send through their photo link wait here for an owner or admin.</p>
          )}
        </Card>

        <Card lit>
          <CardHeader
            title="Change orders"
            subtitle="More work, or less. Signing one moves that scope's budget up or down."
          />
          {changeOrders.length > 0 && (
            <ul className="divide-y divide-[var(--hairline)]">
              {changeOrders.map((contract) => {
                const total = contractTotalCents(contract.lineItems, contract.discountCents);
                return (
                  <li key={contract.id} className="px-5 py-3" data-testid="change-order-row">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{contract.title}</p>
                      <span
                        className={`num text-sm font-medium ${total < 0 ? "text-[var(--ok)]" : ""}`}
                        data-cents={total}
                      >
                        {total < 0 ? `Credit ${formatCents(-total)}` : `+${formatCents(total)}`}
                      </span>
                    </div>
                    <p className="faint num text-xs">
                      <Link href={`/dashboard/contracts/${contract.id}`} className="link">
                        CON-{contract.number}
                      </Link>
                      {contract.amends && ` · changes CON-${contract.amends.number}`}
                      {contract.signedAt && ` · ${formatDate(contract.signedAt, timeZone)}`}
                      {" "}
                      <Badge color={total < 0 ? "#34d399" : "#a78bfa"}>
                        {total < 0 ? "Credit" : "Added"}
                      </Badge>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-[var(--hairline-2)] p-5">
            <ChangeOrderForm projectId={project.id} scopes={scopeChoices} today={today} />
          </div>
        </Card>
      </div>
    </div>
  );
}
