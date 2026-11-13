"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MergeButton, type Hit } from "@/components/merge-button";
import { notTheSameBusiness, undoNotTheSameBusiness } from "../lookalike-actions";
import type { CompanyLookalike } from "@/lib/lookalikes";

// "Looks like the same business" on a company page (Nov 13, 2026; no AI):
// each other company with the same name (ignoring case and punctuation),
// website or phone, with Merge these (Merge Companies with both picked)
// and Not the same business (remembered for the pair, with Undo). Always
// mounted, so its Undo outlives the last suggestion.

const WHY: Record<CompanyLookalike["reasons"][number], string> = { name: "same name", domain: "same website", phone: "same phone" };

export function CompanyLookalikes({ me, rows }: { me: Hit; rows: CompanyLookalike[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; undo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = rows.filter((row) => !gone.includes(row.id));
  if (shown.length === 0 && !notice && !error) return null;

  function dismiss(other: CompanyLookalike) {
    setError(null);
    start(async () => {
      const result = await notTheSameBusiness(me.id, other.id);
      start(() => {
        if (result.error) return setError(result.error);
        setGone((list) => [...list, other.id]);
        setNotice({ text: `${other.name} won't be suggested again.`, undo: other.id });
      });
    });
  }

  function undo(otherId: string) {
    start(async () => {
      const result = await undoNotTheSameBusiness(me.id, otherId);
      start(() => {
        if (result.error) return setError(result.error);
        setGone((list) => list.filter((id) => id !== otherId));
        setNotice(null);
        router.refresh();
      });
    });
  }

  return (
    <section className="card card-lit mb-5 min-w-0 border-l-[3px] border-l-[var(--warn)] p-4" data-testid="company-lookalikes" aria-label="Looks like the same business">
      {shown.length > 0 && (
        <>
          <h2 className="text-sm font-semibold">Looks like the same business</h2>
          <p className="faint mt-0.5 text-xs">Check before you merge: two businesses can share a building&apos;s main line.</p>
          <ul className="mt-2 divide-y divide-[var(--hairline-3)]">
            {shown.map((row) => (
              <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid="company-lookalike" data-company-id={row.id}>
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/companies/${row.id}`} className="link text-sm font-medium [overflow-wrap:anywhere]">
                    {row.name}
                  </Link>
                  <span className="faint block text-xs [overflow-wrap:anywhere]">
                    {[row.reasons.map((reason) => WHY[reason]).join(", "), [row.city, row.state].filter(Boolean).join(", "), row.website, row.phone].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <MergeButton kind="companies" initial={[me, { id: row.id, name: row.name, city: row.city, state: row.state }]} label="Merge these" />
                  <button type="button" onClick={() => dismiss(row)} disabled={pending} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="company-lookalike-dismiss">
                    Not the same business
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {notice && (
        <p className={`${shown.length ? "mt-2" : ""} flex flex-wrap items-center gap-2 text-xs text-[var(--ok)]`} role="status" data-testid="company-lookalike-notice">
          {notice.text}
          <button type="button" className="link text-xs pointer-coarse:min-h-11" onClick={() => undo(notice.undo)} disabled={pending} data-testid="company-lookalike-undo">
            Undo
          </button>
        </p>
      )}
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
    </section>
  );
}
