"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { HealthRing } from "@/components/health-marks";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { IconMessage, IconPhone, IconNote, IconUserPlus } from "@/components/icons";
import { useHowDidItGo } from "@/components/how-did-it-go/how-did-it-go";
import { UP_NEXT_SHOWN } from "@/lib/up-next";
import type { UpNextItem } from "./load";
import { giveBackLeads, takeUnownedLeads } from "./actions";

// Up next on My day (BDR redesign, Nov 11, 2026): one ranked list (the
// order is rankUpNext's), 8 rows then "Show all n". Each row: the health
// ring around the avatar, name, company, the mini meter, the reason line,
// and Call · Text · Log. Call and Text are real tel: / sms: links; when the
// rep comes back from the dialler How did it go? opens on its own for that
// person (data-contact-id on the row). Log opens the same sheet. On a phone
// a sticky bar above the tabs reads "Next: Kelsey Dawson · Call" and moves
// on after each log.
//
// Read-only (an Owner looking at a rep's day): no Call / Text / Log, no
// sticky bar, no Take 10.

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function smsHref(phone: string) {
  return `sms:${phone.replace(/[^\d+]/g, "")}`;
}

export function UpNextList({
  items,
  today,
  readOnly,
  unowned,
}: {
  items: UpNextItem[];
  today: string;
  readOnly: boolean;
  unowned: { count: number; ids: string[] };
}) {
  const how = useHowDidItGo({ dial: !readOnly });
  const [all, setAll] = useState(false);
  // People logged from this page since it loaded, so the phone bar moves
  // on at once (the refresh that follows re-ranks the list).
  const [logged, setLogged] = useState<Set<string>>(() => new Set());
  const shown = all ? items : items.slice(0, UP_NEXT_SHOWN);

  const log = useCallback(
    (item: UpNextItem, type: "PHONE_CALL" | "TEXT" = "PHONE_CALL") =>
      how.open({
        target: { contactId: item.id },
        type,
        name: item.name,
        today,
        onSaved: () => setLogged((prev) => new Set(prev).add(item.id)),
      }),
    [how, today],
  );

  const next = readOnly ? null : (items.find((item) => !logged.has(item.id)) ?? null);

  return (
    <div data-testid="up-next">
      {items.length === 0 ? (
        <p className="faint px-5 py-6 text-sm" data-testid="up-next-empty">
          Nobody waiting on you right now.{readOnly ? "" : " New leads you take or add show up here."}
        </p>
      ) : (
        <ol className="divide-y divide-[var(--hairline-3)]">
          {shown.map((item, index) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5"
              data-contact-id={item.id}
              data-testid="up-next-row"
              data-category={item.category}
            >
              <span className="sr-only">{index + 1}.</span>
              <HealthRing health={item.health}>
                <Avatar url={item.imageUrl} name={item.name} size={36} round />
              </HealthRing>
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-2">
                  <Link href={`/dashboard/contacts/${item.id}`} className="truncate font-medium hover:underline" data-testid="up-next-name">
                    {item.name}
                  </Link>
                  {item.company && <span className="faint truncate text-xs">{item.company}</span>}
                </p>
                <p className="muted mt-0.5 truncate text-[0.8rem]" data-testid="up-next-reason">
                  {item.reason}
                  {item.park && <span className="faint"> · can rest 30 days</span>}
                </p>
              </div>
              <div className="hidden w-36 shrink-0 md:block">
                <LifecycleMeter health={item.health} size="mini" showCaption={false} />
              </div>
              {!readOnly && (
                <div className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto">
                  {item.phone ? (
                    <>
                      <a href={telHref(item.phone)} className="btn btn-ghost btn-sm pointer-coarse:min-h-11 flex-1 sm:flex-none" data-testid="up-next-call" aria-label={`Call ${item.name}`}>
                        <IconPhone size={14} />
                        Call
                      </a>
                      <a href={smsHref(item.phone)} className="btn btn-ghost btn-sm pointer-coarse:min-h-11 flex-1 sm:flex-none" data-testid="up-next-text" aria-label={`Text ${item.name}`}>
                        <IconMessage size={14} />
                        Text
                      </a>
                    </>
                  ) : (
                    <span className="faint flex-1 px-2 text-xs sm:flex-none">No number</span>
                  )}
                  <button type="button" onClick={() => log(item)} className="btn btn-primary btn-sm pointer-coarse:min-h-11 flex-1 sm:flex-none" data-testid="up-next-log">
                    <IconNote size={14} />
                    Log
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {items.length > UP_NEXT_SHOWN && (
        <div className="border-t border-[var(--hairline-3)] px-5 py-2">
          <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAll((open) => !open)} data-testid="up-next-all" aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        </div>
      )}
      {!readOnly && unowned.count > 0 && <TakeUnowned count={unowned.count} ids={unowned.ids} />}
      {next && (
        <OnBody>
        <div
          className="fixed inset-x-0 z-30 border-t border-[var(--hairline-3)] bg-[var(--overlay)] px-4 py-2 lg:hidden"
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
          data-contact-id={next.id}
          data-testid="next-bar"
        >
          <div className="mx-auto flex max-w-xl items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="faint">Next: </span>
              <span className="font-medium" data-testid="next-bar-name">
                {next.name}
              </span>
            </p>
            {next.phone ? (
              <a href={telHref(next.phone)} className="btn btn-primary btn-sm pointer-coarse:min-h-11" data-testid="next-bar-call">
                <IconPhone size={14} />
                Call
              </a>
            ) : (
              <button type="button" onClick={() => log(next)} className="btn btn-primary btn-sm pointer-coarse:min-h-11" data-testid="next-bar-log">
                Log
              </button>
            )}
          </div>
        </div>
        </OnBody>
      )}
      {how.element}
    </div>
  );
}

// "43 new leads nobody owns · Take 10" (decision 18): a claim with a
// confirm, then "Took 10 · Undo".
function TakeUnowned({ count, ids }: { count: number; ids: string[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ids: string[]; at: number } | null>(null);
  const [pending, start] = useTransition();
  const take = Math.min(ids.length, 10);

  function confirm() {
    setError(null);
    start(async () => {
      const result = await takeUnownedLeads(ids.slice(0, take));
      if ("error" in result) {
        setError(result.error);
        setAsking(false);
        router.refresh();
        return;
      }
      setAsking(false);
      setToast({ ids: result.taken, at: Date.now() });
      router.refresh();
    });
  }

  return (
    <div className="border-t border-[var(--hairline-3)] px-4 py-3 sm:px-5" data-testid="unowned">
      {asking ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Take new leads">
          <span className="min-w-0 flex-1">
            Take {take} new {take === 1 ? "lead" : "leads"}? {take === 1 ? "It becomes" : "They become"} yours and{" "}
            {take === 1 ? "lands" : "land"} on Up next.
          </span>
          <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAsking(false)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm pointer-coarse:min-h-11" onClick={confirm} disabled={pending} data-testid="unowned-confirm">
            {pending ? "Taking…" : `Yes, take ${take}`}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <IconUserPlus size={15} className="opacity-70" />
          <span className="min-w-0 flex-1" data-testid="unowned-count">
            {count} new {count === 1 ? "lead" : "leads"} nobody owns
          </span>
          <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAsking(true)} data-testid="unowned-take">
            Take {take}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      <TakeToast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// "Took 10 · Undo": the log sheet's toast, with Undo giving the leads back
// rather than undoing a logged save.
function TakeToast({ toast, onDone }: { toast: { ids: string[]; at: number } | null; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [undone, setUndone] = useState(false);
  if (!toast) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite" data-testid="unowned-toast">
      <span>{undone ? "Given back" : `Took ${toast.ids.length} · they're on your list`}</span>
      {!undone && (
        <button
          type="button"
          className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
          disabled={pending}
          data-testid="unowned-undo"
          onClick={() =>
            start(async () => {
              await giveBackLeads(toast.ids);
              setUndone(true);
              router.refresh();
              window.setTimeout(onDone, 4000);
            })
          }
        >
          Undo
        </button>
      )}
    </div>
  );
}


// Drawn on document.body: the list sits in a .card, whose backdrop blur
// would make the card, not the screen, what position:fixed is placed in.
function OnBody({ children }: { children: React.ReactNode }) {
  // The tenant's brand colour reaches it from <body> (the dashboard layout
  // puts it there once for every portal).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}
