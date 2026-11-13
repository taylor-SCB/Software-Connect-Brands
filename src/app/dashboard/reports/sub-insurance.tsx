import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import type { SubInsuranceFlag } from "@/lib/compliance";

// Subcontractors' papers that have run out or run out within 30 days, on
// the Daily Rundown for Owners and Admins (Taylor, Nov 12, 2026), so
// nobody has to open a job to see it. Shown only when there is something
// to see; the crew card is where a new copy goes.
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function SubInsuranceCard({ items }: { items: SubInsuranceFlag[] }) {
  const expired = items.filter((item) => item.flag === "EXPIRED").length;
  return (
    <Card className="mb-5" lit>
      <CardHeader
        title="Subcontractor insurance to check"
        subtitle={
          expired > 0
            ? `${expired} run out${items.length > expired ? `, ${items.length - expired} running out within 30 days` : ""}`
            : `${items.length} running out within 30 days`
        }
        actions={
          <Link href="/dashboard/projects/crews" className="btn btn-ghost btn-sm" data-testid="sub-insurance-crews">
            Open crews
          </Link>
        }
      />
      <ul className="divide-y divide-[var(--hairline-3)] px-5" data-testid="sub-insurance">
        {items.map((item) => (
          <li
            key={`${item.crewId}:${item.category ?? ""}`}
            className="flex items-center justify-between gap-3 py-2.5 text-sm"
            data-testid="sub-insurance-row"
            data-flag={item.flag}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.crew}</span>
              <span className="faint block truncate text-xs">
                {[item.category ?? "Compliance paper", item.company && item.company !== item.crew ? item.company : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className={`num shrink-0 text-xs font-medium ${item.flag === "EXPIRED" ? "text-[var(--danger)]" : "text-[var(--warn)]"}`}>
              {item.flag === "EXPIRED" ? "Ran out" : "Runs out"} {DAY.format(item.expiresOn)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
