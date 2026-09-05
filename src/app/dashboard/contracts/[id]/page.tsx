import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
} from "@/components/ui";
import { IconTrash, IconSend, IconExternal } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { ContractBodyForm } from "./body-form";
import { setContractStatus, deleteContract } from "../actions";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId },
    include: { contact: { select: { id: true, name: true, company: true } } },
  });
  if (!contract) notFound();

  const publicPath = `/c/${contract.publicToken}`;
  const signed = contract.status === "SIGNED";

  return (
    <div>
      <BackLink href="/dashboard/contracts" label="Contracts" />

      <PageHeader
        eyebrow={`CON-${contract.number} · ${contract.contact.company || contract.contact.name}`}
        title={contract.title}
        actions={
          <>
            <StatusBadge status={contract.status} />
            <Link
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconExternal size={13} />
              Preview
            </Link>
            {contract.status === "DRAFT" && (
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

      {signed && (
        <Card
          className="mb-5 p-4"
          // Signed is the terminal state — make it obvious at a glance.
        >
          <p className="eyebrow mb-1">Signed</p>
          <p className="text-sm">
            <span className="font-semibold">{contract.signerName}</span> accepted this
            contract on{" "}
            {contract.signedAt ? formatDateTime(contract.signedAt) : "—"} UTC.
          </p>
        </Card>
      )}

      {contract.status !== "DRAFT" && (
        <Card className="mb-5 p-4">
          <p className="eyebrow mb-2">Signature link</p>
          <PublicLinkField path={publicPath} />
          <p className="faint mt-2 text-xs">
            Send this to your customer — they can read and sign it in the browser.
            {contract.sentAt && ` Sent ${formatDate(contract.sentAt)}.`}
          </p>
          {!signed && (
            <div className="mt-3 flex flex-wrap gap-2">
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
        </Card>
      )}

      <Card lit>
        <CardHeader
          title="Contract text"
          subtitle={
            signed
              ? "Locked — a signed contract can't be edited."
              : "Merge fields are already filled in. Edit anything before you send it."
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
        <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
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
  );
}
