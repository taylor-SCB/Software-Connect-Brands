import { complianceFlags } from "@/lib/contract-checks";
import { FLAG_WORDS, limitsOf } from "@/lib/compliance-shared";

export type ComplianceInfoView = { namedInsured: string | null; insurer: string | null; policyNumber: string | null; limits: unknown };

// What the file says, under its name, with a red word when it is made out
// to somebody else (Release B, the compliance watchdog).
export function ComplianceDetails({ doc, expectedName }: { doc: { compliance?: ComplianceInfoView | null }; expectedName: string | null }) {
  const info = doc.compliance;
  if (!info) return null;
  const limits = limitsOf(info.limits);
  const nameFlag = complianceFlags({ expiresOn: null, namedInsured: info.namedInsured }, expectedName).includes("NAME");
  const lines = [info.insurer, info.policyNumber ? `No. ${info.policyNumber}` : null].filter(Boolean);
  if (!info.namedInsured && lines.length === 0 && limits.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs" data-testid="compliance-details">
      {info.namedInsured && (
        <p className={nameFlag ? "text-[var(--danger)]" : "muted"} data-testid={nameFlag ? "compliance-name-flag" : undefined}>
          Named insured: {info.namedInsured}
          {nameFlag ? ` · ${FLAG_WORDS.NAME}` : ""}
        </p>
      )}
      {lines.length > 0 && <p className="faint">{lines.join(" · ")}</p>}
      {limits.length > 0 && (
        <p className="faint num">{limits.map((row) => `${row.label} ${shortMoney(row.amountCents)}`).join(" · ")}</p>
      )}
    </div>
  );
}

function shortMoney(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1_000_000 && dollars % 100_000 === 0) return `$${dollars / 1_000_000}M`;
  if (dollars >= 1_000 && dollars % 1_000 === 0) return `$${dollars / 1_000}k`;
  return `$${dollars.toLocaleString("en-US")}`;
}
