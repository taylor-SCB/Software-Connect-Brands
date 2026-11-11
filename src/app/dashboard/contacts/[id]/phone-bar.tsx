"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { IconNote } from "@/components/icons";
import { CallButton, MainAction, TextButton, type MainActionData, type PhoneRow } from "./action-bar";
import { useContactPage } from "./contact-shell";

// The phone's sticky bar (BDR redesign): Call · Text · Log · [the main
// button by stage] · ⋯, 56px tall, in thumb reach at the foot of the
// screen. It sits on top of the app's tab bar (56px, PhoneTabBar in
// sidebar-nav.tsx, which already pads for the phone's home bar), never over
// it (audit, Nov 11, 2026: it hid Today / Contacts / … ). Hidden from a small tablet up, where the header's
// action bar is in view. Drawn on document.body: the page column is
// animated in, which makes it the box a fixed bar would be placed against.
export function PhoneBar({ data, phones, more }: { data: MainActionData; phones: PhoneRow[]; more: React.ReactNode }) {
  const page = useContactPage();
  // Only in the browser: document.body is where it goes.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <nav
      aria-label={`Actions for ${page.name}`}
      className="popover fixed inset-x-0 z-40 grid h-14 grid-flow-col auto-cols-fr items-center gap-1 rounded-none border-x-0 border-b-0 px-2 sm:hidden"
      style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
      data-testid="phone-bar"
    >
      <CallButton phones={phones} variant="bar" />
      <TextButton phones={phones} variant="bar" />
      <button type="button" onClick={() => page.openLog("PHONE_CALL")} className="btn btn-ghost btn-sm min-h-11 w-full flex-col gap-0.5 px-1 text-[0.7rem]" data-testid="phone-bar-log">
        <IconNote size={14} />
        Log
      </button>
      {data.action && (
        <div className="min-w-0">
          <MainAction data={data} phones={phones} variant="bar" />
        </div>
      )}
      {more}
    </nav>,
    document.body,
  );
}
