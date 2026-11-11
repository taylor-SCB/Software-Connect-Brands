"use client";

import { useState } from "react";
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
  return (
    <details
      className={className}
      open={open}
      data-testid={testId}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next === open) return;
        setOpen(next);
        void saveUiPref(namespace, prefKey, next);
      }}
    >
      {summary}
      {children}
    </details>
  );
}
