"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FloatingMenu } from "@/components/floating-menu";
import { StatusPanel } from "@/components/status-picker";
import { StatusBadge } from "@/components/ui";
import { HeaderDeleteButton } from "@/components/header-delete-button";
import { AdditionalAccountButton } from "@/components/additional-account-button";
import { IconEdit, IconFileText, IconPlus, IconSignature } from "@/components/icons";
import { deleteContact } from "../actions";
import { AddDealForm } from "./forms";

const ITEM = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] pointer-coarse:min-h-11";

// ⋯ More on the contact page (BDR redesign, Release 4): the header's
// second-line actions, one tap deeper. New quote, New contract, Edit,
// Additional Account, Set status by hand (today's full picker with its
// skipped-step dates and Archived, grouped) and Delete at the foot with
// its confirm. Drawn twice — the header and the phone's bottom bar — each
// with its own button.
export function MoreMenu({
  contactId,
  contactName,
  linkedIds,
  status,
  meetingSetOn,
  today,
  addDeal = false,
  testId = "record-more",
  buttonClassName = "btn btn-ghost btn-sm pointer-coarse:min-h-11",
  label = "⋯ More",
}: {
  contactId: string;
  contactName: string;
  linkedIds: string[];
  status: string;
  meetingSetOn: string | null;
  today: string;
  // Before Meeting Completed (and with no deal yet) the Add deal form is
  // not offered on the page (the plan: a deal is not invited before a
  // meeting); it stays here, one tap deeper, so nothing is lost.
  addDeal?: boolean;
  testId?: string;
  buttonClassName?: string;
  label?: React.ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "status" | "deal">("menu");
  const [round, setRound] = useState(0);
  const [accounts, setAccounts] = useState(false);

  function close() {
    setOpen(false);
    setView("menu");
  }

  // Keyboard: the panel is drawn on the body, so focus goes into it when
  // it opens (a frame later, once it has placed itself) and back to the
  // button when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const frame = requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-testid=${`${testId}-menu`}] a, [data-testid=${`${testId}-menu`}] button`)?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      if (!document.activeElement || document.activeElement === document.body) anchor.current?.focus({ preventScroll: true });
    }
  }, [open, testId]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={buttonClassName}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More actions"
        onClick={() => (open ? close() : setOpen(true))}
        data-testid={testId}
      >
        {label}
      </button>
      <FloatingMenu anchor={anchor} open={open} onClose={close} width={280} label="More actions" testId={`${testId}-menu`}>
        {view === "deal" ? (
          <div data-testid="more-add-deal-form">
            <button type="button" className="link px-3 pt-2 text-xs" onClick={() => setView("menu")}>
              ← More
            </button>
            <AddDealForm contactId={contactId} />
          </div>
        ) : view === "status" ? (
          <div data-testid="status-menu">
            <button type="button" className="link px-3 pt-2 text-xs" onClick={() => setView("menu")}>
              ← More
            </button>
            <StatusPanel key={round} kind="contact" id={contactId} status={status} meetingSetOn={meetingSetOn} today={today} onDone={close} />
          </div>
        ) : (
          <div className="py-1">
            <Link href={`/dashboard/quotes/new?contactId=${contactId}`} className={ITEM} data-testid="more-new-quote">
              <IconFileText size={13} />
              New quote
            </Link>
            <Link href={`/dashboard/contracts/new?contactId=${contactId}`} className={ITEM} data-testid="more-new-contract">
              <IconSignature size={13} />
              New contract
            </Link>
            <Link href={`/dashboard/contacts/${contactId}/edit`} className={ITEM} data-testid="more-edit">
              <IconEdit size={13} />
              Edit
            </Link>
            {addDeal && (
              <button type="button" className={ITEM} onClick={() => setView("deal")} data-testid="more-add-deal">
                <IconPlus size={13} />
                Add deal
              </button>
            )}
            <button
              type="button"
              className={ITEM}
              onClick={() => {
                close();
                setAccounts(true);
              }}
              data-testid="additional-account"
            >
              <IconPlus size={13} />
              Additional Account
            </button>
            <button
              type="button"
              className={`${ITEM} justify-between`}
              onClick={() => {
                setRound(round + 1);
                setView("status");
              }}
              data-testid="status-picker"
            >
              <span>Set status by hand</span>
              <StatusBadge status={status} />
            </button>
            <div className="mt-1 flex justify-end border-t border-[var(--hairline-3)] px-3 pb-1 pt-2">
              <HeaderDeleteButton
                action={deleteContact}
                hiddenName="contactId"
                hiddenValue={contactId}
                question={`Delete ${contactName}, with their notes, activity, deals, quotes and contracts?`}
              />
            </div>
          </div>
        )}
      </FloatingMenu>
      <AdditionalAccountButton contactId={contactId} contactName={contactName} linkedIds={linkedIds} open={accounts} onOpenChange={setAccounts} />
    </>
  );
}
