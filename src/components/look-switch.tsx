"use client";

import { useEffect, useState, useTransition } from "react";
import { setTheme } from "@/app/dashboard/theme-actions";
import { THEMES, THEME_COOKIE, THEME_COOKIE_MAX_AGE, THEME_LABELS, type Theme } from "@/lib/theme-names";

// Dark / Light. In the sidebar under the workspace name, in the phone's
// top bar, and top right of the signed-out pages. The look changes the
// moment it is tapped (the data-theme attribute is set here) and is saved
// — to the person when signed in, and to this browser either way.
// The caller sets the display (inline-flex, or hidden lg:inline-flex): a
// "hidden" passed in would lose to a built-in inline-flex.
export function LookSwitch({ theme, className = "" }: { theme: Theme; className?: string }) {
  const [current, setCurrent] = useState<Theme>(theme);
  const [, start] = useTransition();

  // Keep this browser's cookie on the look being shown, so the login page
  // after Log out matches what the person last saw.
  useEffect(() => {
    document.cookie = `${THEME_COOKIE}=${current}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  }, [current]);

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
