"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { IconChevronDown, IconMerge, IconUpload, IconMail, IconSparkles, IconNote } from "@/components/icons";
import { FloatingMenu } from "@/components/floating-menu";
import { ImportCsvButton } from "@/components/import-csv-button";
import { MergeButton } from "@/components/merge-button";
import { EmailButton } from "@/components/email-composer";
import { FillMissingButton } from "@/app/dashboard/companies/fill-missing-button";
import { useHowDidItGo } from "@/components/how-did-it-go/how-did-it-go";

// The client pieces of the Contacts and Companies lists (BDR redesign, Nov
// 11, 2026): the Clean up ▾ menu, the Log button and the tap-to-call
// return, and a company row's expand.

// Clean up ▾ — Import CSV, Merge, Find duplicates and (companies) Fill in
// missing, one tap deeper than they were. The four are the same buttons
// as before, mounted out of sight so their dialogs open exactly as they
// always did; a menu item presses the matching one. On a phone the Email
// button joins them (the header shows only + Add and this menu).
export function CleanUpMenu({
  kind,
  reps,
}: {
  kind: "contacts" | "companies";
  reps: { id: string; name: string; removed?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLSpanElement>(null);
  const press = (index: number) => {
    setOpen(false);
    const target = host.current?.querySelectorAll<HTMLElement>(":scope > span > button")[index];
    // After the menu has gone, so the dialog takes the focus.
    requestAnimationFrame(() => target?.click());
  };
  const item = "flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--hover)] md:min-h-0";
  return (
    <>
      {/* The real buttons, hidden; their dialogs are their siblings and show. */}
      <span ref={host} className="contents">
        <span className="contents [&>button]:hidden">
          <ImportCsvButton kind={kind} reps={reps} />
        </span>
        <span className="contents [&>button]:hidden">
          <MergeButton kind={kind} />
        </span>
        {kind === "companies" ? (
          <span className="contents [&>button]:hidden">
            <FillMissingButton />
          </span>
        ) : (
          <span className="contents [&>button]:hidden">
            <EmailButton />
          </span>
        )}
      </span>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-ghost btn-sm min-h-[44px] md:min-h-0"
        data-testid="cleanup"
      >
        <span className="hidden md:inline">Clean up</span>
        <span className="px-1 text-base leading-none md:hidden" aria-label="More">⋯</span>
        <IconChevronDown size={12} className="hidden opacity-70 md:inline" />
      </button>
      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={240} testId="cleanup-menu" label="Clean up">
        <div className="py-1" role="menu">
          {kind === "contacts" && (
            <button type="button" role="menuitem" className={`${item} md:hidden`} onClick={() => press(2)} data-testid="cleanup-email">
              <IconMail size={14} /> Email
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={() => press(0)} data-testid="cleanup-import">
            <IconUpload size={14} /> Import CSV
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => press(1)} data-testid="cleanup-merge">
            <IconMerge size={14} /> Merge {kind === "contacts" ? "contacts" : "companies"}
          </button>
          <Link role="menuitem" href={`/dashboard/${kind}/duplicates`} className={item} data-testid="find-duplicates" onClick={() => setOpen(false)}>
            <IconMerge size={14} /> Find duplicates
          </Link>
          {kind === "companies" && (
            <button type="button" role="menuitem" className={item} onClick={() => press(2)} data-testid="cleanup-fill">
              <IconSparkles size={14} /> Fill in missing
            </button>
          )}
        </div>
      </FloatingMenu>
    </>
  );
}

// Log and tap-to-call for every row: one "How did it go?" sheet for the
// list, opened by Log, and by itself when the rep comes back from a tel:
// or sms: link carrying data-contact-id (useHowDidItGo's dial return).
const LogContext = createContext<((contactId: string, name: string) => void) | null>(null);

export function ListLogProvider({ children }: { children: React.ReactNode }) {
  const how = useHowDidItGo({ dial: true });
  const { open } = how;
  const log = useCallback((contactId: string, name: string) => open({ target: { contactId }, name }), [open]);
  return (
    <LogContext.Provider value={log}>
      {children}
      {how.element}
    </LogContext.Provider>
  );
}

export function LogButton({ contactId, name, className = "" }: { contactId: string; name: string; className?: string }) {
  const log = useContext(LogContext);
  if (!log) return null;
  return (
    <button type="button" onClick={() => log(contactId, name)} className={`btn btn-ghost btn-sm ${className}`} data-testid="row-log" aria-label={`Log a touch with ${name}`}>
      <IconNote size={14} />
      Log
    </button>
  );
}

// A company row's expand: shows or hides the row under it (its top three
// people with their meters and Call), without opening the company.
export function RowExpand({ target, label }: { target: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={target}
      aria-label={`${open ? "Hide" : "Show"} the top people at ${label}`}
      onClick={() => {
        const row = document.getElementById(target);
        if (row) row.hidden = open;
        setOpen(!open);
      }}
      className="btn btn-ghost btn-sm !px-1.5"
      data-testid="row-expand"
    >
      <IconChevronDown size={13} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

// The phone card list or the desktop table: only one is ever in the page,
// so a name is on it once. The server picks by the browser's own word for
// itself (a phone's user agent); once the page has loaded, the screen's
// width decides, so a narrow desktop window still gets cards.
export function ResponsiveList({ phone, desktop, initialPhone }: { phone: React.ReactNode; desktop: React.ReactNode; initialPhone: boolean }) {
  const [isPhone, setIsPhone] = useState(initialPhone);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return <>{isPhone ? phone : desktop}</>;
}
