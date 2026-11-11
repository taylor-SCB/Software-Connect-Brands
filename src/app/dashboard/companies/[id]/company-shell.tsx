"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActivityTypeValue } from "@/lib/constants";
import { IconX } from "@/components/icons";
import { undoLog } from "@/app/dashboard/contacts/actions";
import type { CompanyPerson } from "@/components/company-people-picker";
import { HowDidItGo } from "@/components/how-did-it-go/how-did-it-go";
import { useDialReturn } from "@/components/how-did-it-go/dial-return";
import { useBookMeeting } from "@/components/book-meeting/book-meeting";

// The company page's moving parts (BDR redesign, Nov 11, 2026) share one
// small state: whose Book meeting sheet is open, whether Log a touch and
// the header's ⋯ More are open, which Who to call row's log is open, and
// the "Saved · Undo" line after a save from the page itself. The header's
// main button, the meter's next step, the Who to call rows and the
// phone's sticky bar all reach the same sheets and toggles through it.
// Logging is the shared How did it go? sheet (on the company: Who? first,
// with Front desk; on a row: that person) and booking the shared Book
// meeting sheet, each with its own Saved · Undo.

export type BookPerson = { id: string; name: string; title: string | null };

type Saved = { message: string; batchId?: string | null; href?: { label: string; to: string } | null };

type Shell = {
  book: (contactId?: string | null) => void;
  // Log a touch: How did it go? on the company.
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  openLog: (type?: ActivityTypeValue) => void;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  openMore: () => void;
  // The Who to call row whose How did it go? is open.
  rowLog: string | null;
  setRowLog: (id: string | null, type?: ActivityTypeValue) => void;
  saved: (saved: Saved) => void;
};

const ShellContext = createContext<Shell | null>(null);

export function useCompanyShell() {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useCompanyShell outside CompanyShell");
  return shell;
}

// Scrolls a section into view the frame after it opens.
function reveal(id: string) {
  requestAnimationFrame(() => {
    const element = document.getElementById(id);
    if (!element) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  });
}

const KINDS = new Set<string>(["PHONE_CALL", "TEXT", "EMAIL", "MEETING"]);
// openLog is often an onClick, which hands it the click event.
const kindOf = (value: unknown): ActivityTypeValue => (typeof value === "string" && KINDS.has(value) ? (value as ActivityTypeValue) : "PHONE_CALL");

type LogState = { open: boolean; who: string | null; type: ActivityTypeValue };

export function CompanyShell({
  companyId,
  companyName,
  people,
  companyPeople,
  userName,
  today,
  children,
}: {
  companyId: string;
  companyName: string;
  // The Who to call rows, for a row's log and Book.
  people: BookPerson[];
  // The company's first people, for How did it go?'s "Who?".
  companyPeople: CompanyPerson[];
  // Who is logging, for the Front desk line.
  userName?: string;
  // yyyy-mm-dd on the workspace's clock.
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [log, setLog] = useState<LogState>({ open: false, who: null, type: "PHONE_CALL" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState<(Saved & { key: number }) | null>(null);
  const booking = useBookMeeting();
  const openBook = booking.open;
  const peopleRef = useRef(people);
  const logRef = useRef(log);
  useEffect(() => {
    peopleRef.current = people;
    logRef.current = log;
  });

  const saved = useCallback(
    (next: Saved) => {
      setToast({ ...next, key: Date.now() });
      router.refresh();
    },
    [router],
  );
  const book = useCallback(
    (contactId?: string | null) => {
      const list = peopleRef.current;
      // The person asked for, else the first one here (the warmest).
      const person = contactId ? (list.find((row) => row.id === contactId) ?? null) : (list[0] ?? null);
      const id = contactId ?? person?.id ?? null;
      if (!id) {
        saved({ message: "Add the person you'll meet to this company first, then book it with them." });
        return;
      }
      openBook({ contactId: id, name: person?.name, today });
    },
    [openBook, saved, today],
  );
  const openLog = useCallback((type?: ActivityTypeValue) => setLog({ open: true, who: null, type: kindOf(type) }), []);
  const setLogOpen = useCallback((open: boolean) => (open ? setLog({ open: true, who: null, type: "PHONE_CALL" }) : setLog((prev) => ({ ...prev, open: false }))), []);
  const setRowLog = useCallback(
    (id: string | null, type?: ActivityTypeValue) => (id ? setLog({ open: true, who: id, type: kindOf(type) }) : setLog((prev) => ({ ...prev, open: false }))),
    [],
  );
  const closeLog = useCallback(() => setLog((prev) => ({ ...prev, open: false })), []);
  const openMore = useCallback(() => {
    setMoreOpen(true);
    reveal("company-header");
  }, []);

  // Back from the phone app after a tel: or sms: tap: the row's person
  // when the link sat in their row, else the company (the main line). A
  // sheet the tap already opened is left as it is.
  useDialReturn({ contactIds: people.map((row) => row.id), companyId, page: true }, (tap) => {
    if (logRef.current.open) return;
    if (tap.contactId && peopleRef.current.some((row) => row.id === tap.contactId)) setRowLog(tap.contactId, tap.type);
    else openLog(tap.type);
  });

  const value = useMemo(
    () => ({
      book,
      logOpen: log.open && log.who === null,
      setLogOpen,
      openLog,
      moreOpen,
      setMoreOpen,
      openMore,
      rowLog: log.open ? log.who : null,
      setRowLog,
      saved,
    }),
    [book, log.open, log.who, setLogOpen, openLog, moreOpen, openMore, setRowLog, saved],
  );

  const person = log.who ? (people.find((row) => row.id === log.who) ?? null) : null;

  return (
    <ShellContext.Provider value={value}>
      {children}
      {log.who ? (
        <HowDidItGo
          open={log.open}
          onClose={closeLog}
          target={{ contactId: log.who }}
          type={log.type}
          name={person?.name}
          today={today}
          current={{ id: log.who, name: person?.name ?? "", company: companyName }}
        />
      ) : (
        <HowDidItGo
          open={log.open}
          onClose={closeLog}
          target={{ companyId }}
          type={log.type}
          name={companyName}
          today={today}
          companyPeople={companyPeople}
          userName={userName}
        />
      )}
      {booking.element}
      {toast && <SavedToast key={toast.key} saved={toast} onDone={() => setToast(null)} />}
    </ShellContext.Provider>
  );
}


// "Saved · Undo" for ten seconds after a save from this page. Undo takes
// the whole save back (undoLog).
function SavedToast({ saved, onDone }: { saved: Saved; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  useEffect(() => {
    const timer = setTimeout(onDone, error ? 15_000 : 10_000);
    return () => clearTimeout(timer);
  }, [onDone, error]);
  return createPortal(
    <div
      role="status"
      className="popover card fixed inset-x-4 bottom-20 z-[60] mx-auto flex max-w-lg flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-4 py-3 text-sm lg:bottom-6"
      data-testid="company-saved"
    >
      <span className="min-w-0 flex-1">{saved.message}</span>
      {saved.href && (
        <Link href={saved.href.to} className="link shrink-0 text-sm">
          {saved.href.label} →
        </Link>
      )}
      {saved.batchId && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await undoLog(saved.batchId!);
              if (result.error) {
                setError(result.error);
                return;
              }
              router.refresh();
              onDone();
            })
          }
          className="btn btn-ghost btn-sm shrink-0 pointer-coarse:min-h-11"
          data-testid="company-saved-undo"
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      )}
      <button type="button" onClick={onDone} aria-label="Close" className="btn btn-ghost btn-sm shrink-0 pointer-coarse:min-h-11">
        <IconX size={12} />
      </button>
      {error && (
        <p className="w-full text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>,
    document.body,
  );
}

