"use client";

// "Is this the same person?": a new person or business that looks like one
// already here waits for an answer before the card can be saved.
export function SameBox({
  what,
  said,
  rows,
  onUse,
  onNew,
}: {
  what: "person" | "company";
  said: string;
  rows: { id: string; line: string; reason: string }[];
  onUse: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--tint-2)] p-3" role="group" aria-label={`Is ${said} already here?`} data-testid="pai-same">
      <p className="text-sm">
        <span className="font-medium">{said}</span>: is this {what === "person" ? "someone" : "a business"} you already have?
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-words text-sm">
              {row.line} <span className="faint text-xs">({row.reason})</span>
            </span>
            <button type="button" onClick={() => onUse(row.id)} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="pai-same-use" data-id={row.id}>
              Use {what === "person" ? "them" : "this one"}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onNew} className="btn btn-ghost btn-sm mt-2 min-h-11 sm:min-h-0" data-testid="pai-same-new">
        No, make a new {what === "person" ? "contact" : "company"}
      </button>
    </div>
  );
}
