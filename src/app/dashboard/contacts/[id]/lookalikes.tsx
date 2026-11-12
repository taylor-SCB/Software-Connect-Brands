"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MergeButton, type Hit } from "@/components/merge-button";
import { linkContactAccounts } from "../account-actions";
import { notTheSamePerson, undoNotTheSamePerson } from "../lookalike-actions";
import type { Lookalike } from "@/lib/lookalikes";

// "Looks like the same person" on a contact's page (AI release A, Nov 12,
// 2026; no AI): each other record sharing an email, a phone, or the name
// at another company, with Merge these (Merge Contacts with both picked),
// + Additional Account (this person also belongs to the other record's
// company) and Not the same person (remembered for the pair, with Undo).

const WHY: Record<Lookalike["reasons"][number], string> = { email: "same email", phone: "same phone", name: "same name" };

export function Lookalikes({ me, rows }: { me: Hit; rows: Lookalike[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; undo?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = rows.filter((row) => !gone.includes(row.id));
  if (shown.length === 0 && !notice) return null;

  function dismiss(other: Lookalike) {
    setError(null);
    start(async () => {
      const result = await notTheSamePerson(me.id, other.id);
      start(() => {
        if (result.error) return setError(result.error);
        setGone((list) => [...list, other.id]);
        setNotice({ text: `${other.name} won't be suggested again.`, undo: other.id });
      });
    });
  }

  function undo(otherId: string) {
    start(async () => {
      const result = await undoNotTheSamePerson(me.id, otherId);
      start(() => {
        if (result.error) return setError(result.error);
        setGone((list) => list.filter((id) => id !== otherId));
        setNotice(null);
        router.refresh();
      });
    });
  }

  function link(other: Lookalike) {
    if (!other.companyId) return;
    setError(null);
    start(async () => {
      const result = await linkContactAccounts({ contactId: me.id, companyIds: [other.companyId!], newCompany: null });
      start(() => {
        if (result.error) return setError(result.error);
        setNotice({ text: `${me.name} is now also at ${other.company}.` });
        router.refresh();
      });
    });
  }

  return (
    <section className="card card-lit mt-4 min-w-0 border-l-[3px] border-l-[var(--warn)] p-4" data-testid="lookalikes" aria-label="Looks like the same person">
      {shown.length > 0 && (
        <>
          <h2 className="text-sm font-semibold">Looks like the same person</h2>
          <p className="faint mt-0.5 text-xs">Check before you merge: two people can share an office phone.</p>
          <ul className="mt-2 divide-y divide-[var(--hairline-3)]">
            {shown.map((row) => (
              <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid="lookalike" data-contact-id={row.id}>
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/contacts/${row.id}`} className="link text-sm font-medium [overflow-wrap:anywhere]">
                    {row.name}
                  </Link>
                  <span className="faint block text-xs [overflow-wrap:anywhere]">
                    {[row.reasons.map((reason) => WHY[reason]).join(", "), row.company, row.email, row.phone].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <MergeButton
                    kind="contacts"
                    initial={[me, { id: row.id, name: row.name, email: row.email, phone: row.phone, company: row.company }]}
                    label="Merge these"
                  />
                  {!row.linked && (
                    <button type="button" onClick={() => link(row)} disabled={pending} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="lookalike-account">
                      + Additional Account
                    </button>
                  )}
                  <button type="button" onClick={() => dismiss(row)} disabled={pending} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="lookalike-dismiss">
                    Not the same person
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {notice && (
        <p className={`${shown.length ? "mt-2" : ""} flex flex-wrap items-center gap-2 text-xs text-[var(--ok)]`} role="status" data-testid="lookalike-notice">
          {notice.text}
          {notice.undo && (
            <button type="button" className="link text-xs pointer-coarse:min-h-11" onClick={() => undo(notice.undo!)} disabled={pending} data-testid="lookalike-undo">
              Undo
            </button>
          )}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
    </section>
  );
}
