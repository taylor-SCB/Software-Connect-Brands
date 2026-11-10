import { formatDate } from "@/lib/format";
import type { MarketingTally } from "@/lib/last-contacted";

// The Marketing column on the Contacts and Companies lists (Nov 10, 2026):
// how many marketing emails went out and the last one. Never a touch, so
// it sits apart from Last Contacted By and the Activity counts.
export function MarketingCell({ tally, timeZone }: { tally?: MarketingTally; timeZone: string | null }) {
  if (!tally) return <span className="faint text-xs">—</span>;
  return (
    <div className="whitespace-nowrap text-xs" data-testid="marketing-cell">
      <p className="num font-medium">
        {tally.count} {tally.count === 1 ? "email" : "emails"}
      </p>
      <p className="faint num">last {formatDate(tally.last, timeZone)}</p>
    </div>
  );
}

// Who owns the record; nobody reads Unassigned.
export function RepCell({ name }: { name: string | null }) {
  return (
    <span className={`whitespace-nowrap text-xs ${name ? "" : "faint"}`} data-testid="rep-cell">
      {name ?? "Unassigned"}
    </span>
  );
}

// "Added by Nic Rivera · Nov 10, 2026" on a contact's or company's page.
export function AddedBy({ name, at, timeZone }: { name: string | null; at: Date; timeZone: string | null }) {
  return (
    <span data-testid="added-by">
      {name ? `Added by ${name}` : "Added"} · {formatDate(at, timeZone)}
    </span>
  );
}

// The "Marketing" badge on a feed line written by an email marketing send.
export function MarketingBadge() {
  return (
    <span className="badge ml-1.5 border-[var(--border-strong)] text-[0.6rem] uppercase tracking-wide" data-testid="marketing-badge">
      Marketing
    </span>
  );
}
