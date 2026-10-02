"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MergeButton } from "@/components/merge-button";
import { FormError, StatusBadge } from "@/components/ui";
import { dismissDuplicate } from "@/app/dashboard/duplicate-actions";

export type PairRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  email2?: string | null;
  phone2?: string | null;
  company?: string | null;
  city: string | null;
  state: string | null;
  status: string;
  added: string;
};

export type PairView = {
  a: PairRecord;
  b: PairRecord;
  reasons: string[];
  strength: "strong" | "weak";
  acrossCompanies: boolean;
};

function Side({ record, kind }: { record: PairRecord; kind: "contacts" | "companies" }) {
  const lines = [
    kind === "contacts" ? record.company || "No company" : null,
    [record.email, record.email2].filter(Boolean).join(" · ") || null,
    [record.phone, record.phone2].filter(Boolean).join(" · ") || null,
    [record.city, record.state].filter(Boolean).join(", ") || null,
  ].filter(Boolean);
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/dashboard/${kind}/${record.id}`} className="truncate text-sm font-medium hover:underline">
          {record.name}
        </Link>
        <StatusBadge status={record.status} />
      </div>
      {lines.map((line) => (
        <p key={line} className="faint mt-0.5 truncate text-xs">
          {line}
        </p>
      ))}
      <p className="faint mt-1 text-[0.68rem]">Added {record.added}</p>
    </div>
  );
}

// One suggestion on the Duplicate radar: the two records side by side, what
// matched, and the two answers — merge them (today's Merge, with the pair
// already picked and the older one kept) or "Not the same person".
export function DuplicatePair({
  pair,
  kind,
  stay = true,
}: {
  pair: PairView;
  kind: "contacts" | "companies";
  // On the radar the page stays put; on a record's own page the merge goes
  // to whichever record was kept, since this one may be gone.
  stay?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  function dismiss() {
    setError(undefined);
    start(async () => {
      const result = await dismissDuplicate({ kind: kind === "contacts" ? "contact" : "company", a: pair.a.id, b: pair.b.id });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const hit = (record: PairRecord) => ({
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    company: record.company ?? null,
    city: record.city,
    state: record.state,
  });

  return (
    <li className="card p-4" data-testid="dup-pair" data-strength={pair.strength}>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {pair.reasons.map((reason) => (
          <span key={reason} className="badge" data-testid="dup-reason">
            {reason}
          </span>
        ))}
        {pair.strength === "weak" && (
          <span className="faint text-xs">
            {kind === "contacts" ? "Name only, at different companies — check before merging" : "Name only, in different cities — check before merging"}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Side record={pair.a} kind={kind} />
        <Side record={pair.b} kind={kind} />
      </div>
      {pair.acrossCompanies && (
        <p className="faint mt-2 text-xs" data-testid="dup-across">
          Same person at two companies? Merging keeps one record and links the other company as an Additional Account.
        </p>
      )}
      <FormError message={error} />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={dismiss} disabled={pending} className="btn btn-ghost btn-sm" data-testid="dup-dismiss">
          {pending ? "Saving…" : kind === "contacts" ? "Not the same person" : "Not the same company"}
        </button>
        <MergeButton kind={kind} initial={[hit(pair.a), hit(pair.b)]} label="Merge these" stay={stay} />
      </div>
    </li>
  );
}
