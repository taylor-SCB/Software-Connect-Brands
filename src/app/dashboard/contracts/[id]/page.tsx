import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate, formatDateTime } from "@/lib/format";
import { canUserSend } from "@/lib/contracts";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
  Badge,
} from "@/components/ui";
import { IconTrash, IconSend, IconExternal, IconDownload } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { ContractBodyForm } from "./body-form";
import { setContractStatus, deleteContract } from "../actions";

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
          company: { select: { id: true, name: true } },
        },
      },
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
        eyebrow={`CON-${contract.number}${contract.deal ? ` · ${contract.deal.title}` : ""} · ${contract.contact.company?.name || contract.contact.name}`}
        title={contract.title}
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

          {!signed && (
            <Card className="border-[rgb(251_113_133/0.25)]">
              <CardHeader title="Danger zone" />
              <form action={deleteContract} className="p-5">
                <input type="hidden" name="contractId" value={contract.id} />
                <button type="submit" className="btn btn-danger btn-sm">
                  <IconTrash size={13} />
                  Delete contract
                </button>
              </form>
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
                  {contract.contact.company ? (
                    <Link href={`/dashboard/companies/${contract.contact.company.id}`} className="link">
                      {contract.contact.company.name}
                    </Link>
                  ) : (
                    <span className="faint">None · residential</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Deal</dt>
                <dd className="mt-0.5">
                  {contract.deal ? (
                    <>
                      <Link href={`/dashboard/deals/${contract.deal.id}`} className="link">
                        {contract.deal.title}
                      </Link>{" "}
                      <StatusBadge status={contract.deal.stage} />
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
              {contract.status === "DRAFT" ? (
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
