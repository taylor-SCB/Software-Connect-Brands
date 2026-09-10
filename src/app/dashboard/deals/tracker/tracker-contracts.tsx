import Link from "next/link";
import { formatCents, formatDate } from "@/lib/format";
import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { IconExternal, IconSignature } from "@/components/icons";
import { ReminderButton } from "@/components/reminder-button";
import type { TrackerContract } from "@/lib/tracker";
import { cancelContract, reopenContract } from "./actions";

// Every contract made off the deal: who it went to, where it stands, what
// it is worth, what has been paid, and the nudges sent so far.
export function TrackerContracts({
  contracts,
  organizationName,
  timeZone,
}: {
  contracts: TrackerContract[];
  organizationName: string;
  timeZone: string;
}) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        icon={<IconSignature size={20} />}
        title="No contracts on this deal yet"
        body="Tick rows in the grid above and create them. They will show here with their status, dates and payments."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-hover" data-testid="tracker-contracts">
        <thead>
          <tr>
            <th>Contract</th>
            <th>To</th>
            <th>Status</th>
            <th>Sent</th>
            <th>Signed</th>
            <th className="text-right">Total</th>
            <th>Payments</th>
            <th>Reminders</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => {
            const path = `/c/${contract.publicToken}`;
            const message = `Hi ${contract.recipientName}, a quick reminder that ${contract.title} (CON-${contract.number}) from ${organizationName} is waiting for your signature. You can read and sign it here: {{link}}`;
            return (
              <tr key={contract.id} data-testid="tracker-contract" data-status={contract.status}>
                <td>
                  <Link href={`/dashboard/contracts/${contract.id}`} className="font-medium hover:underline">
                    {contract.title}
                  </Link>
                  <p className="faint num text-xs">
                    CON-{contract.number} · <Badge>{contract.type}</Badge>
                  </p>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <Avatar url={contract.recipientCompany?.logoUrl} name={contract.recipientCompany?.name ?? contract.recipientName} size={26} />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{contract.recipientCompany?.name ?? contract.recipientName}</p>
                      {contract.recipientCompany && (
                        <p className="faint truncate text-xs">{contract.recipientName}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <StatusBadge status={contract.status} />
                </td>
                <td className="faint text-xs">{contract.sentAt ? formatDate(contract.sentAt, timeZone) : "—"}</td>
                <td className="faint text-xs">{contract.signedAt ? formatDate(contract.signedAt, timeZone) : "—"}</td>
                <td className="num text-right font-medium">
                  {contract.lineCount ? formatCents(contract.totalCents) : <span className="faint">—</span>}
                </td>
                <td className="text-xs">
                  {contract.paymentCount === 0 ? (
                    <span className="faint">No schedule</span>
                  ) : (
                    <>
                      <p className="num">
                        {formatCents(contract.paidCents)} <span className="faint">of {formatCents(contract.totalCents)} paid</span>
                      </p>
                      {contract.nextDue ? (
                        <p className="faint">
                          Next: {formatCents(contract.nextDue.amountCents)}
                          {contract.nextDue.dueOn ? ` on ${formatDate(contract.nextDue.dueOn, "UTC")}` : ""}
                        </p>
                      ) : (
                        <p className="text-[var(--ok)]">Paid in full</p>
                      )}
                    </>
                  )}
                </td>
                <td className="text-xs">
                  {contract.reminderCount === 0 ? (
                    <span className="faint">None</span>
                  ) : (
                    <>
                      <p>{contract.reminderCount} sent</p>
                      {contract.lastReminderAt && (
                        <p className="faint">Last {formatDate(contract.lastReminderAt, timeZone)}</p>
                      )}
                    </>
                  )}
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    {contract.status === "SENT" && (
                      <ReminderButton contractId={contract.id} message={message} path={path} compact />
                    )}
                    <Link href={`/dashboard/contracts/${contract.id}`} className="btn btn-ghost btn-sm" title="Open">
                      <IconExternal size={13} />
                      Edit
                    </Link>
                    {contract.status === "CANCELLED" ? (
                      <form action={reopenContract}>
                        <input type="hidden" name="contractId" value={contract.id} />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Reopen
                        </button>
                      </form>
                    ) : (
                      contract.status !== "SIGNED" && (
                        <form action={cancelContract}>
                          <input type="hidden" name="contractId" value={contract.id} />
                          <button type="submit" className="btn btn-ghost btn-sm" data-testid="cancel-contract">
                            Cancel
                          </button>
                        </form>
                      )
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
