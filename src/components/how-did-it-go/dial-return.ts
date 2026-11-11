"use client";

import { useEffect, useRef } from "react";

// "When the rep comes back to the app, How did it go? is already open and
// set to Call" (BDR redesign, Nov 11, 2026). A tap on a tel: or sms: link
// anywhere on the page is remembered; when the page goes hidden (the phone
// app took over) and comes back within two hours, the sheet registered for
// that person opens itself. The person is read from the nearest
// data-contact-id (or data-company-id) around the link; a link with none
// goes to the page's own sheet (the first one registered with `page`).
// Nothing happens on a desktop where the dialler never hides the page.

export type DialTap = { type: "PHONE_CALL" | "TEXT"; contactId: string | null; companyId: string | null; at: number };
type Handler = { contactIds: string[]; companyId: string | null; page: boolean; any: boolean; fire: (tap: DialTap) => void };

const WINDOW_MS = 2 * 60 * 60 * 1000;
const handlers = new Set<Handler>();
let pending: DialTap | null = null;
let hiddenSince = 0;
let listening = false;

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href^='tel:'], a[href^='sms:']") as HTMLAnchorElement | null;
      if (!link) return;
      const holder = link.closest("[data-contact-id], [data-company-id]") as HTMLElement | null;
      pending = {
        type: link.getAttribute("href")!.toLowerCase().startsWith("sms:") ? "TEXT" : "PHONE_CALL",
        contactId: holder?.dataset.contactId ?? link.dataset.contactId ?? null,
        companyId: holder?.dataset.companyId ?? link.dataset.companyId ?? null,
        at: Date.now(),
      };
      hiddenSince = 0;
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (pending) hiddenSince = Date.now();
      return;
    }
    const tap = pending;
    if (!tap || !hiddenSince || Date.now() - tap.at > WINDOW_MS) return;
    pending = null;
    hiddenSince = 0;
    const list = Array.from(handlers);
    const match =
      (tap.contactId ? list.find((handler) => handler.contactIds.includes(tap.contactId!)) : undefined) ??
      (tap.companyId ? list.find((handler) => handler.companyId === tap.companyId) : undefined) ??
      (tap.contactId ? list.find((handler) => handler.any) : undefined) ??
      list.find((handler) => handler.page);
    match?.fire(tap);
  });
}

// The sheet is open (however it got there: the desktop dialler's
// focus-back, Who to call, a Log button): the tap it answers is spent, so
// a later trip away from the tab doesn't open it a second time.
export function clearDialReturn() {
  pending = null;
  hiddenSince = 0;
}

// Registers a sheet for the people it logs on. `page`: this is the page's
// own log, which takes a tap on a link that names nobody. `any`: a list
// (Up next) that opens the sheet for whoever the tapped link names.
export function useDialReturn(
  options: { contactIds: string[]; companyId?: string | null; page?: boolean; any?: boolean; enabled?: boolean },
  fire: (tap: DialTap) => void,
) {
  const latest = useRef(fire);
  useEffect(() => {
    latest.current = fire;
  }, [fire]);
  const key = options.contactIds.join(",");
  useEffect(() => {
    if (options.enabled === false) return;
    listen();
    const handler: Handler = {
      contactIds: key ? key.split(",") : [],
      companyId: options.companyId ?? null,
      page: Boolean(options.page),
      any: Boolean(options.any),
      fire: (tap) => latest.current(tap),
    };
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, [key, options.companyId, options.page, options.any, options.enabled]);
}
