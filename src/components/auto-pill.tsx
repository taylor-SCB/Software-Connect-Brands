import { formatDate } from "@/lib/format";

// The small faint "auto" mark next to a value the app filled in on its
// own (Company.autoFilled). No hooks, so lists and pages can render it
// from the server. Hovering says when.
export function AutoPill({
  field,
  autoFilled,
  enrichedAt,
  timeZone,
}: {
  field: "industries" | "phone" | "website";
  autoFilled: string[];
  enrichedAt: Date | null;
  timeZone: string;
}) {
  // Tags are filled as a pair, so either name lights the one mark.
  const on = field === "industries" ? autoFilled.includes("industries") || autoFilled.includes("companyTypes") : autoFilled.includes(field);
  if (!on) return null;
  const when = enrichedAt ? ` on ${formatDate(enrichedAt, timeZone)}` : "";
  return (
    <span
      data-testid="auto-pill"
      data-field={field}
      title={`Filled in by the app${when}`}
      className="badge ml-1 border-dashed border-[var(--border-strong)] align-middle font-normal text-[var(--text-faint)]"
    >
      auto
    </span>
  );
}
