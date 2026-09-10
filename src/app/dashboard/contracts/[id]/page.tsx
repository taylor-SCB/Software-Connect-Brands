import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate, formatDateTime, formatCents } from "@/lib/format";
import { canUserSend, contractTotalCents } from "@/lib/contracts";
import { dateToIso, todayIso } from "@/lib/payments";
import { computeQuoteTotals } from "@/lib/quote-math";
import { LINE_ITEM_TAGS } from "@/lib/constants";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
  Badge,
  TagBadge,
} from "@/components/ui";
import { IconTrash, IconSend, IconExternal, IconDownload, IconClock } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { Avatar } from "@/components/avatar";
import { ReminderButton } from "@/components/reminder-button";
import { ContractBodyForm } from "./body-form";
import { PaymentScheduleEditor } from "./payment-schedule-editor";
import { SignerForm } from "./signer-form";
import { setContractStatus, deleteContract } from "../actions";
import { cancelContract, reopenContract } from "@/app/dashboard/deals/tracker/actions";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId, userId } = await requireSession();

  const timeZone = await getTimeZone();

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId },
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          title: true,
          email: true,
          phone: true,
          company: { select: { id: true, name: true, logoUrl: true } },
        },
      },
      company: { select: { id: true, name: true, logoUrl: true } },
      lineItems: { orderBy: { position: "asc" } },
      payments: { orderBy: { position: "asc" } },
      deal: { select: { id: true, title: true, stage: true } },
      quote: { select: { id: true, number: true, title: true, status: true } },
      template: {
        select: { id: true, name: true, allUsersCanSend: true, senderUserIds: true },
      },
    },
  });
  if (!contract) notFound();

  const publicPath = `/c/${contract.publicToken}`;
  const signed = contract.status === "SIGNED";
  const cancelled = contract.status === "CANCELLED";
  // The business the document is addressed to: the one picked on the
  // tracker, else the contact's own.
  const recipient = contract.company ?? contract.contact.company ?? null;
  const totals = computeQuoteTotals(contract.lineItems);
  const totalCents = contractTotalCents(contract.lineItems);
  const activeTags = LINE_ITEM_TAGS.filter((tag) => totals.byTag[tag] !== 0);
  const reminderMessage = `Hi ${contract.contact.name}, a quick reminder that ${contract.title} (CON-${contract.number}) is waiting for your signature. You can read and sign it here: {{link}}`;

  // "Who can send" from the template, enforced again in the action.
  const canSend = canUserSend(contract.template, userId);
  const senderNames =
    !canSend && contract.template
      ? (
          await prisma.user.findMany({
            where: { organizationId, id: { in: contract.template.senderUserIds } },
            select: { name: true },
          })
        ).map((user) => user.name)
      : [];

  return (
    <div>
      <BackLink href="/dashboard/contracts" label="Contracts" current={`CON-${contract.number} ${contract.title}`} />

      <PageHeader
        eyebrow={`CON-${contract.number}${contract.deal ? ` · ${contract.deal.title}` : ""} · ${recipient?.name || contract.contact.name}`}
        title={contract.title}
        leading={<Avatar url={recipient?.logoUrl} name={recipient?.name ?? contract.contact.name} size={48} />}
        actions={
          <>
            <Badge>{contract.type}</Badge>
            <StatusBadge status={contract.status} />
            <Link
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconExternal size={13} />
              Customer view
            </Link>
            <a href={`${publicPath}/pdf`} className="btn btn-ghost btn-sm">
              <IconDownload size={13} />
              PDF
            </a>
            {contract.status === "DRAFT" && canSend && (
              <form action={setContractStatus}>
                <input type="hidden" name="contractId" value={contract.id} />
                <input type="hidden" name="status" value="SENT" />
                <button type="submit" className="btn btn-primary btn-sm">
                  <IconSend size={13} />
                  Send for signature
                </button>
              </form>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        {/* ---------------------------- Agreement ---------------------------- */}
        <div className="min-w-0 flex-1 space-y-5">
          {signed && (
            <Card className="p-4">
              <p className="eyebrow mb-1">Signed</p>
              <p className="text-sm">
                <span className="font-semibold">{contract.signerName}</span> accepted this
                contract on{" "}
                {contract.signedAt ? formatDateTime(contract.signedAt, timeZone) : "—"}.
              </p>
            </Card>
          )}

          <Card lit>
            <CardHeader
              title="Agreement"
              subtitle={
                signed
                  ? "Locked — a signed contract can't be edited."
                  : "Fields are already filled in. Edit anything before you send it."
              }
            />
            <ContractBodyForm
              contractId={contract.id}
              title={contract.title}
              body={contract.body}
              locked={signed}
            />
          </Card>

          {contract.lineItems.length > 0 && (
            <Card lit>
              <CardHeader
                title="Line items"
                subtitle="The rows split onto this contract from the quote. They print under the agreement."
              />
              <div className="overflow-x-auto">
                <table className="table" data-testid="contract-line-items">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Tag</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.lineItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <p className="font-medium">{item.name}</p>
                          {item.description && <p className="faint text-xs">{item.description}</p>}
                        </td>
                        <td><TagBadge tag={item.tag} /></td>
                        <td className="num text-right">{item.quantity}</td>
                        <td className="num text-right">{formatCents(item.unitPriceCents)}</td>
                        <td className="num text-right font-medium">{formatCents(Math.round(item.quantity * item.unitPriceCents))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="text-right text-xs">
                        {activeTags.map((tag) => (
                          <span key={tag} className="ml-3 faint">{tag.charAt(0) + tag.slice(1).toLowerCase().replace("_", " ")} {formatCents(totals.byTag[tag])}</span>
                        ))}
                        <span className="ml-4 font-semibold text-[var(--text)]">Total</span>
                      </td>
                      <td className="num text-right text-base font-semibold" data-testid="contract-total">{formatCents(totalCents)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          {(contract.lineItems.length > 0 || contract.payments.length > 0) && (
            <Card lit>
              <CardHeader
                title="Payment schedule"
                subtitle={
                  signed
                    ? "Amounts and dates are locked after signature. Tick payments as they come in."
                    : "Percent of the total, a fixed amount, or the balance. Amounts recalculate as you go."
                }
              />
              <PaymentScheduleEditor
                contractId={contract.id}
                totalCents={totalCents}
                paymentTerms={contract.paymentTerms ?? ""}
                today={todayIso(timeZone)}
                locked={signed}
                initialRows={contract.payments.map((payment) => ({
                  label: payment.label,
                  kind: payment.kind,
                  percent: payment.percent,
                  amountCents: payment.amountCents,
                  dueOn: dateToIso(payment.dueOn),
                  paid: Boolean(payment.paidAt),
                }))}
              />
            </Card>
          )}

          {!signed && (
            <Card className="border-[rgb(251_113_133/0.25)]">
              <CardHeader title="Danger zone" />
              <div className="flex flex-wrap gap-2 p-5">
                {cancelled ? (
                  <form action={reopenContract}>
                    <input type="hidden" name="contractId" value={contract.id} />
                    <button type="submit" className="btn btn-ghost btn-sm">
                      Reopen as draft
                    </button>
                  </form>
                ) : (
                  <form action={cancelContract}>
                    <input type="hidden" name="contractId" value={contract.id} />
                    <button type="submit" className="btn btn-ghost btn-sm" data-testid="cancel-contract">
                      Cancel contract
                    </button>
                  </form>
                )}
                <form action={deleteContract}>
                  <input type="hidden" name="contractId" value={contract.id} />
                  <button type="submit" className="btn btn-danger btn-sm">
                    <IconTrash size={13} />
                    Delete contract
                  </button>
                </form>
              </div>
              <p className="faint px-5 pb-4 text-xs">
                Cancelling keeps the record and frees its rows on the Deal Tracker. Deleting removes it.
              </p>
            </Card>
          )}
        </div>

        {/* --------------------------- Silver line --------------------------- */}
        <div className="divider-silver-h lg:hidden" aria-hidden="true" />
        <div className="divider-silver hidden self-stretch lg:block" aria-hidden="true" />

        {/* ----------------------- Customer Information ---------------------- */}
        <div className="w-full space-y-5 lg:w-[340px] lg:shrink-0">
          <Card lit>
            <CardHeader title="Customer Information" subtitle="Who this agreement is for." />
            <dl className="space-y-3 p-5 text-sm">
              <div>
                <dt className="eyebrow">Customer</dt>
                <dd className="mt-0.5">
                  <Link href={`/dashboard/contacts/${contract.contact.id}`} className="link font-medium">
                    {contract.contact.name}
                  </Link>
                  {contract.contact.title && (
                    <span className="faint"> · {contract.contact.title}</span>
                  )}
                  {(contract.contact.email || contract.contact.phone) && (
                    <p className="faint text-xs">
                      {[contract.contact.email, contract.contact.phone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Company</dt>
                <dd className="mt-0.5">
                  {recipient ? (
                    <span className="flex items-center gap-2">
                      <Avatar url={recipient.logoUrl} name={recipient.name} size={22} />
                      <Link href={`/dashboard/companies/${recipient.id}`} className="link">
                        {recipient.name}
                      </Link>
                    </span>
                  ) : (
                    <span className="faint">None · residential</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Your signer</dt>
                <dd className="mt-1">
                  <SignerForm contractId={contract.id} signerName={contract.senderSignerName ?? ""} locked={signed} />
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Deal</dt>
                <dd className="mt-0.5">
                  {contract.deal ? (
                    <>
                      <Link href={`/dashboard/contracts/tracker?dealId=${contract.deal.id}`} className="link">
                        {contract.deal.title}
                      </Link>{" "}
                      <StatusBadge status={contract.deal.stage} />
                      <Link href={`/dashboard/contracts/tracker?dealId=${contract.deal.id}`} className="faint ml-2 inline-flex items-center gap-1 text-xs hover:text-[var(--text)]">
                        <IconClock size={11} /> Deal Tracker
                      </Link>
                    </>
                  ) : (
                    <span className="faint">None</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Quote</dt>
                <dd className="mt-0.5">
                  {contract.quote ? (
                    <>
                      <Link href={`/dashboard/quotes/${contract.quote.id}`} className="link">
                        QUO-{contract.quote.number} · {contract.quote.title}
                      </Link>{" "}
                      <StatusBadge status={contract.quote.status} />
                    </>
                  ) : (
                    <span className="faint">None</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Template</dt>
                <dd className="mt-0.5">
                  {contract.template ? (
                    <Link href={`/dashboard/contracts/templates/${contract.template.id}`} className="link">
                      {contract.template.name}
                    </Link>
                  ) : (
                    <span className="faint">Deleted</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card lit>
            <CardHeader title="Sending" subtitle="Where the customer reads and signs." />
            <div className="space-y-3 p-5">
              {cancelled ? (
                <p className="muted text-sm">
                  Cancelled{contract.cancelledAt ? ` ${formatDate(contract.cancelledAt, timeZone)}` : ""}. Its rows are open again on the
                  Deal Tracker. Reopen it below to send it after all.
                </p>
              ) : contract.status === "DRAFT" ? (
                canSend ? (
                  <>
                    <p className="muted text-sm">
                      Not sent yet. Sending turns the customer&apos;s link on and moves the deal
                      to Contract Sent.
                    </p>
                    <form action={setContractStatus}>
                      <input type="hidden" name="contractId" value={contract.id} />
                      <input type="hidden" name="status" value="SENT" />
                      <button type="submit" className="btn btn-primary w-full">
                        <IconSend size={14} />
                        Send for signature
                      </button>
                    </form>
                  </>
                ) : (
                  <p
                    role="note"
                    className="rounded-lg border border-[rgb(251_191_36/0.35)] bg-[rgb(251_191_36/0.08)] px-3 py-2 text-xs text-[var(--warn)]"
                  >
                    Only {senderNames.length ? senderNames.join(", ") : "the people named on the template"} can send
                    this agreement. Ask them, or change “Who can send?” on the template.
                  </p>
                )
              ) : (
                <>
                  <p className="eyebrow">Signature link</p>
                  <PublicLinkField path={publicPath} />
                  <p className="faint text-xs">
                    Text or email this to your customer — they can read and sign it in the browser.
                    {contract.sentAt && ` Sent ${formatDate(contract.sentAt, timeZone)}.`}
                  </p>
                  {contract.status === "SENT" && (
                    <div className="pt-1">
                      <ReminderButton contractId={contract.id} message={reminderMessage} path={publicPath} />
                      <p className="faint mt-1 text-xs">
                        {contract.reminderCount === 0
                          ? "No reminders yet."
                          : `${contract.reminderCount} ${contract.reminderCount === 1 ? "reminder" : "reminders"} sent${contract.lastReminderAt ? `, last ${formatDate(contract.lastReminderAt, timeZone)}` : ""}.`}
                      </p>
                    </div>
                  )}
                  {!signed && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <form action={setContractStatus}>
                        <input type="hidden" name="contractId" value={contract.id} />
                        <input type="hidden" name="status" value="DRAFT" />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Pull back to draft
                        </button>
                      </form>
                      <form action={setContractStatus}>
                        <input type="hidden" name="contractId" value={contract.id} />
                        <input type="hidden" name="status" value="DECLINED" />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Mark declined
                        </button>
                      </form>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
