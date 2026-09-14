import { formatCents, formatDate } from "@/lib/format";
import type { Balance } from "@/lib/money";

// "Owes you $4,200.00 · 1 overdue · next due Sep 30" under a name on the
// Companies and Contacts lists — the first thing a contractor looks for
// in the morning. Nothing at all when the balance is zero, so a quiet
// list stays quiet.
export function OwesLine({ balance, timeZone }: { balance: Balance | undefined; timeZone: string }) {
  if (!balance || balance.owedCents <= 0) return null;
  return (
    <div className="num mt-0.5 text-xs font-normal" data-testid="owes-line" data-cents={balance.owedCents}>
      <span className={balance.overdueCount > 0 ? "text-[var(--danger)]" : "muted"}>
        Owes you {formatCents(balance.owedCents)}
      </span>
      {balance.overdueCount > 0 && (
        <span className="text-[var(--danger)]"> · {balance.overdueCount} overdue</span>
      )}
      {balance.nextDue && (
        <span className="faint"> · next due {formatDate(new Date(`${balance.nextDue}T12:00:00Z`), timeZone)}</span>
      )}
    </div>
  );
}
