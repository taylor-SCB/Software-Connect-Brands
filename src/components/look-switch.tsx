"use client";

import { useState, useTransition } from "react";
import { setTheme } from "@/app/dashboard/theme-actions";
import { THEMES, THEME_LABELS, type Theme } from "@/lib/theme-names";

// Dark / Light / Bright, top right of every signed-in page. The look
// changes the moment it is tapped (the attribute on the shell is set
// here), and is saved to the person so it is the same on their phone.
// The caller sets the display (inline-flex, or hidden lg:inline-flex): a
// "hidden" passed in would lose to a built-in inline-flex.
export function LookSwitch({ theme, className = "" }: { theme: Theme; className?: string }) {
  const [current, setCurrent] = useState<Theme>(theme);
  const [, start] = useTransition();

  function pick(next: Theme) {
    if (next === current) return;
    setCurrent(next);
    for (const shell of document.querySelectorAll<HTMLElement>("[data-theme]")) shell.dataset.theme = next;
    start(async () => {
      await setTheme(next);
    });
  }

  return (
    <div
      role="group"
      aria-label="Look"
      className={`items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5 ${className}`}
      data-testid="look-switch"
    >
      {THEMES.map((name) => {
        const on = name === current;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            onClick={() => pick(name)}
            className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition-colors ${
              on ? "bg-[var(--brand)] text-[var(--brand-contrast)]" : "text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
            data-testid={`look-${name}`}
          >
            {THEME_LABELS[name]}
          </button>
        );
      })}
    </div>
  );
}
