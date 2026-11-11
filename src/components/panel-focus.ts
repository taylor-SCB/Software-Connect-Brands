"use client";

import { useEffect, useRef, type RefObject } from "react";

// Keyboard focus for a FloatingMenu opened from a button (audit, Nov 11,
// 2026). The panel is drawn at the end of document.body, so Tab from the
// button walks the page instead of the panel, and the panel closes once
// the button scrolls away with focus outside it. Opening moves focus to the
// panel's first control (a frame later: the panel is hidden while it places
// itself); closing hands it back to the button when it would otherwise land
// on the page body. The same steps MoreMenu takes.
export function usePanelFocus(open: boolean, panelTestId: string, anchor: RefObject<HTMLElement | null>) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const frame = requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            `[data-testid="${panelTestId}"] :is(a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]))`,
          )
          ?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      if (!document.activeElement || document.activeElement === document.body) anchor.current?.focus({ preventScroll: true });
    }
  }, [open, panelTestId, anchor]);
}
