"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveUiPref } from "../prefs-actions";

// A collapsed section whose open / shut is remembered for the person
// (User.uiPrefs), e.g. My day's "Team & money" (BDR redesign, Round 2).
export function RememberedDetails({
  namespace,
  prefKey,
  initialOpen,
  summary,
  children,
  testId,
  className = "",
}: {
  namespace: string;
  prefKey: string;
  initialOpen: boolean;
  summary: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const router = useRouter();
  const [, start] = useTransition();
  // children is null when the server didn't build them (the section was
  // shut when the page loaded): opening saves the choice, then refreshes
  // so the server builds them.
  const empty = children === null || children === undefined;
  return (
    <details
      className={className}
      open={open}
      data-testid={testId}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next === open) return;
        setOpen(next);
        start(async () => {
          await saveUiPref(namespace, prefKey, next);
          if (next && empty) router.refresh();
        });
      }}
    >
      {summary}
      {empty ? (open ? <p className="faint px-5 pb-4 text-sm" role="status">Loading…</p> : null) : children}
    </details>
  );
}
