"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { IconNote } from "@/components/icons";
import { CallButton, MainAction, TextButton, type MainActionData, type PhoneRow } from "./action-bar";
import { useContactPage } from "./contact-shell";

// The phone's sticky bar (BDR redesign): Call · Text · Log · [the main
// button by stage] · ⋯, 56px tall, in thumb reach at the foot of the
// screen. It sits above the phone's tab bar when one sets
// --phone-tabbar-h. Hidden from a small tablet up, where the header's
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
      style={{ bottom: "var(--phone-tabbar-h, 0px)", paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="phone-bar"
    >
      <CallButton phones={phones} variant="bar" />
      <TextButton phones={phones} variant="bar" />
      <button type="button" onClick={page.openLog} className="btn btn-ghost btn-sm min-h-11 w-full flex-col gap-0.5 px-1 text-[0.7rem]" data-testid="phone-bar-log">
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
