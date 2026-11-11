"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconMessage, IconNote, IconPhone } from "@/components/icons";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { LogActivityForm } from "@/app/dashboard/contacts/[id]/forms";
import type { LeadHealth } from "@/lib/health";
import { useCompanyShell } from "./company-shell";

export type CallRow = {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  phone2: string | null;
  mobile: string | null;
  favorite: boolean;
  // Here as an additional account, not their main company.
  linked: boolean;
  // The Primary POC on an open Pipeline tile.
  main: boolean;
  // "Last: VM · 3d · 4 tries", or null when never tried.
  last: string | null;
  health: LeadHealth;
};

const SHOWN = 5;
const SHOWN_PHONE = 3;
const ROW_BUTTON = "btn btn-ghost btn-sm relative z-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11";

// "Who to call" (BDR redesign, Nov 11, 2026; it was the People card, fifth
// on the page and A–Z): the company's people by stage, then health, each
// with their title, mobile, mini meter and "Last: VM · 3d · 4 tries", a
// "Main contact" tag on the Pipeline's Primary POC, and Call / Text / Log
// / Book. Five rows (three on a phone), then Show all. Call dials and
// opens that person's log under their row, so "how did it go?" is waiting
// when the rep comes back; Book opens the Book meeting sheet. `nudge` (the
// "not linked to a person yet" line) sits at the top.
export function WhoToCall({
  rows,
  total,
  page,
  pages,
  companyId,
  companyName,
  today,
  nudge,
}: {
  rows: CallRow[];
  total: number;
  page: number;
  pages: number;
  companyId: string;
  companyName: string;
  today: string;
  nudge: React.ReactNode;
}) {
  const shell = useCompanyShell();
  const [expanded, setExpanded] = useState(false);
  // A row whose log was opened from elsewhere (the main button) is shown.
  const target = shell.rowLog ? rows.findIndex((row) => row.id === shell.rowLog) : -1;
  const all = expanded || target >= SHOWN || (pages > 1 && page > 1);
  const hiddenCount = rows.length - SHOWN;

  return (
    <div>
      {nudge}
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium">Nobody here yet</p>
          <p className="faint mt-1 text-xs">Add the person you actually talk to, and their calls, quotes and deals show up on this page.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--hairline-3)]" data-testid="who-to-call">
          {rows.map((row, index) => {
            const hide = all ? "" : index >= SHOWN ? "hidden" : index >= SHOWN_PHONE && index !== target ? "max-sm:hidden" : "";
            return (
              <li key={row.id} className={hide} data-testid="person-row" data-contact-id={row.id}>
                <PersonRow row={row} logOpen={shell.rowLog === row.id} onLog={(open) => shell.setRowLog(open ? row.id : null)} onBook={() => shell.book(row.id)} />
                {shell.rowLog === row.id && (
                  <div className="border-t border-[var(--hairline-3)] bg-[var(--tint-1)]" data-testid="person-log">
                    <p className="px-5 pt-3 text-xs font-medium">How did it go with {row.name}?</p>
                    <LogActivityForm target={{ contactId: row.id }} current={{ id: row.id, name: row.name, company: companyName }} today={today} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!all && hiddenCount > 0 && (
        <div className="border-t border-[var(--hairline-3)] px-5 py-2">
          <button type="button" onClick={() => setExpanded(true)} className="link text-sm pointer-coarse:min-h-11" data-testid="who-show-all">
            Show all {total.toLocaleString()}
          </button>
        </div>
      )}
      {!all && hiddenCount <= 0 && rows.length > SHOWN_PHONE && (
        <div className="border-t border-[var(--hairline-3)] px-5 py-2 sm:hidden">
          <button type="button" onClick={() => setExpanded(true)} className="link text-sm min-h-11" data-testid="who-show-all-phone">
            Show all {total.toLocaleString()}
          </button>
        </div>
      )}
      {all && pages > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--hairline-3)] px-5 py-2.5 text-xs">
          <span className="faint">
            Page {page} of {pages}
          </span>
          <span className="flex gap-1">
            {page > 1 ? (
              <Link href={`/dashboard/companies/${companyId}?people=${page - 1}#people`} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" aria-label="Previous people">
                <IconChevronLeft size={13} />
              </Link>
            ) : (
              <span className="btn btn-ghost btn-sm pointer-events-none opacity-40">
                <IconChevronLeft size={13} />
              </span>
            )}
            {page < pages ? (
              <Link href={`/dashboard/companies/${companyId}?people=${page + 1}#people`} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" aria-label="Next people">
                <IconChevronRight size={13} />
              </Link>
            ) : (
              <span className="btn btn-ghost btn-sm pointer-events-none opacity-40">
                <IconChevronRight size={13} />
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function PersonRow({ row, logOpen, onLog, onBook }: { row: CallRow; logOpen: boolean; onLog: (open: boolean) => void; onBook: () => void }) {
  // Their numbers, each a tap to call; the mobile first, since that is
  // the one that gets answered.
  const numbers = [
    row.mobile ? { label: "Mobile ", number: row.mobile } : null,
    row.phone ? { label: "", number: row.phone } : null,
  ].filter((entry) => entry !== null);
  const best = row.mobile ?? row.phone ?? row.phone2;
  const parts: React.ReactNode[] = [
    row.title,
    ...numbers.map(({ label, number }) => (
      <a key={`${label}${number}`} href={`tel:${number}`} className="link num relative z-10" data-testid="person-call">
        {label}
        {number}
      </a>
    )),
  ].filter(Boolean);

  return (
    // The name's link covers the row; the numbers, the meter and the
    // buttons sit above it, so a tap on one of them is theirs.
    <div className="relative flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          <Link href={`/dashboard/contacts/${row.id}`} className="min-w-0 truncate after:absolute after:inset-0 hover:underline" data-testid="person-name">
            {row.favorite && (
              <span className="mr-1 text-[var(--warn)]" aria-label="Favorite">
                ★
              </span>
            )}
            {row.name}
          </Link>
          {row.main && (
            <span className="badge border-[var(--border)] text-[0.68rem] font-medium text-[var(--text)]" data-testid="main-contact">
              Main contact
            </span>
          )}
          {row.linked && (
            <span className="badge border-[var(--border)] text-[0.68rem] font-normal text-[var(--text-dim)]" data-testid="linked-person">
              Additional account
            </span>
          )}
        </p>
        {parts.length > 0 && (
          <p className="faint mt-0.5 truncate text-xs">
            {parts.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && " · "}
                {part}
              </Fragment>
            ))}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <LifecycleMeter health={row.health} size="mini" showCaption={false} className="relative z-10" testId="person-meter" />
          <span className="text-xs text-[var(--text-dim)]" data-testid="person-last">
            {row.last ?? (row.health.state === "NEW" ? "Not tried yet" : row.health.miniCaption)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5" data-testid="person-actions">
        {best && (
          <a href={`tel:${best}`} onClick={() => onLog(true)} className={ROW_BUTTON} aria-label={`Call ${row.name}`} data-testid="person-call-button">
            <IconPhone size={13} />
            Call
          </a>
        )}
        {row.mobile && (
          <a href={`sms:${row.mobile}`} onClick={() => onLog(true)} className={ROW_BUTTON} aria-label={`Text ${row.name}`} data-testid="person-text">
            <IconMessage size={13} />
            Text
          </a>
        )}
        <button type="button" onClick={() => onLog(!logOpen)} aria-expanded={logOpen} className={ROW_BUTTON} aria-label={`Log a touch with ${row.name}`} data-testid="person-log-button">
          <IconNote size={13} />
          Log
        </button>
        <button type="button" onClick={onBook} className={ROW_BUTTON} aria-label={`Book a meeting with ${row.name}`} data-testid="person-book">
          <IconCalendar size={13} />
          Book
        </button>
      </div>
    </div>
  );
}
