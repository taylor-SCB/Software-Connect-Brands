import Link from "next/link";
import { formatCents, formatDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui";
import type { Balance } from "@/lib/money";

// One open payment row, so the card can say what is due and let it be
// opened on the contract it belongs to.
export type OpenRow = {
  contractId: string;
  contractNumber: number;
  label: string;
  amountCents: number;
  receivedCents: number;
  dueOn: string | null;
  overdue: boolean;
};

// The money box on a company or contact page: what they owe, what we owe
// them, and every open row underneath. Shown even at zero so there is
// always somewhere to look.
export function BalanceCard({
  owed,
  payable,
  rows,
  timeZone,
  subtitle,
}: {
  owed: Balance;
  payable?: Balance;
  rows: OpenRow[];
  timeZone: string;
  subtitle?: string;
}) {
  const theyOwe = owed.owedCents > 0;
  const weOwe = (payable?.owedCents ?? 0) > 0;
  return (
    <Card lit>
      <CardHeader title="Balance" subtitle={subtitle ?? "What is signed for and not yet paid."} />
      <div className="space-y-2 px-5 py-4" data-testid="balance-card">
        <div className="flex items-baseline justify-between gap-3">
          <span className="muted text-sm">Owes you</span>
          <span
            className={`num text-lg font-semibold ${owed.overdueCount > 0 ? "text-[var(--danger)]" : ""}`}
            data-testid="balance-owed"
            data-cents={owed.owedCents}
          >
            {formatCents(owed.owedCents)}
          </span>
        </div>
        {owed.overdueCount > 0 && (
          <p className="num text-xs text-[var(--danger)]">
            {owed.overdueCount} {owed.overdueCount === 1 ? "payment is" : "payments are"} past due
          </p>
        )}
        {theyOwe && owed.nextDue && (
          <p className="faint num text-xs">
            Next due {formatDate(new Date(`${owed.nextDue}T12:00:00Z`), timeZone)}
          </p>
        )}
        {weOwe && (
          <div className="flex items-baseline justify-between gap-3 border-t border-[rgb(255_255_255/0.06)] pt-2">
            <span className="muted text-sm">You owe them</span>
            <span className="num text-lg font-semibold" data-testid="balance-payable" data-cents={payable?.owedCents ?? 0}>
              {formatCents(payable?.owedCents ?? 0)}
            </span>
          </div>
        )}
        {!theyOwe && !weOwe && <p className="faint text-sm">Nothing outstanding.</p>}
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-[rgb(255_255_255/0.045)] border-t border-[rgb(255_255_255/0.06)]">
          {rows.map((row) => (
            <li key={`${row.contractId}-${row.label}-${row.dueOn ?? ""}`} className="px-5 py-3" data-testid="balance-row">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/dashboard/contracts/${row.contractId}`} className="link text-sm">
                  {row.label}
                </Link>
                <span className="num text-sm font-medium">
                  {formatCents(row.amountCents - row.receivedCents)}
                </span>
              </div>
              <p className="faint num text-xs">
                CON-{row.contractNumber}
                {row.dueOn && (
                  <span className={row.overdue ? "text-[var(--danger)]" : ""}>
                    {" · "}
                    {row.overdue ? "was due " : "due "}
                    {formatDate(new Date(`${row.dueOn}T12:00:00Z`), timeZone)}
                  </span>
                )}
                {row.receivedCents > 0 && ` · ${formatCents(row.receivedCents)} paid`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
