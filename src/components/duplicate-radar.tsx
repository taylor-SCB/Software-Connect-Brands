import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { formatDate } from "@/lib/format";
import { scanDuplicates, MAX_PAIRS, REASON_LABELS, type DupPair, type DupRecord } from "@/lib/duplicates";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { IconMerge } from "@/components/icons";
import { DuplicatePair, type PairView } from "@/components/duplicate-pair";

// Duplicate radar (Oct 2, 2026): CRM → Contacts / Companies → Possible
// Duplicates. Every likely pair of twins, strongest first, each with what
// matched. One click opens Merge with the pair picked; "Not the same
// person" puts it away for good.
export async function DuplicateRadar({ kind }: { kind: "contacts" | "companies" }) {
  const { organizationId } = await requireSession();
  const timeZone = await getTimeZone();
  const pairs = await scanDuplicates(organizationId, kind === "contacts" ? "contact" : "company");

  const record = (row: DupRecord) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    email2: row.email2 ?? null,
    phone2: row.phone2 ?? null,
    company: row.company ?? null,
    city: row.city,
    state: row.state,
    status: row.status,
    added: formatDate(row.createdAt, timeZone),
  });
  const view = (pair: DupPair): PairView => ({
    a: record(pair.a),
    b: record(pair.b),
    reasons: pair.reasons.map((reason) => REASON_LABELS[reason]),
    strength: pair.strength,
    acrossCompanies: pair.acrossCompanies,
  });
  const noun = kind === "contacts" ? "contacts" : "companies";
  const strong = pairs.filter((pair) => pair.strength === "strong").length;

  return (
    <div>
      <PageHeader
        eyebrow="Relationships"
        title="Possible Duplicates"
        subtitle={
          pairs.length === 0
            ? `No likely twins among your ${noun}`
            : `${pairs.length >= MAX_PAIRS ? `${MAX_PAIRS}+` : pairs.length} to check · ${strong} strong match${strong === 1 ? "" : "es"}`
        }
        actions={
          <Link href={`/dashboard/${kind}`} className="btn btn-ghost btn-sm">
            All {noun}
          </Link>
        }
      />
      <p className="faint mb-4 max-w-3xl text-xs leading-relaxed">
        {kind === "contacts"
          ? "Matched on the same phone number however it's written, the same email in either slot, Matt and Matthew at one company, or the same name. The older record is ticked to keep; you can change that before merging."
          : "Matched on the same name once Inc, LLC and the like are set aside, the same phone number, or the same website. Two companies with one name in different cities are shown as a weaker match."}
      </p>
      {pairs.length === 0 ? (
        <Card>
          <EmptyState icon={<IconMerge size={20} />} title="Nothing to tidy up" body="New imports and new records are checked every time this page opens." />
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="dup-list">
          {pairs.map((pair) => (
            <DuplicatePair key={`${pair.a.id}-${pair.b.id}`} pair={view(pair)} kind={kind} />
          ))}
        </ul>
      )}
    </div>
  );
}
