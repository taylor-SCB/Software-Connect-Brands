"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

// A menu that floats over the page from a button (Oct 27, 2026). Drawn on
// document.body and placed against the screen, so a narrow pipeline
// column, a scrolling board or the sidebar can never cut it off: it opens
// below the button, or above when there is more room there, and is pulled
// back inside the window at either edge. Closes on a click elsewhere,
// Escape, or when its button scrolls out of view.
export function FloatingMenu({
  anchor,
  open,
  onClose,
  width = 288,
  children,
  testId,
  label,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  testId?: string;
  label?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const button = anchor.current;
      if (!button) return;
      const box = button.getBoundingClientRect();
      const viewWidth = document.documentElement.clientWidth;
      const viewHeight = window.innerHeight;
      if (box.bottom < 0 || box.top > viewHeight) {
        close.current();
        return;
      }
      const w = Math.min(width, viewWidth - 16);
      const left = Math.min(Math.max(8, box.left), viewWidth - 8 - w);
      const below = viewHeight - box.bottom - 12;
      const above = box.top - 12;
      const height = panel.current?.scrollHeight ?? 0;
      const up = height > below && above > below;
      setPlace(
        up
          ? { left, width: w, bottom: viewHeight - box.top + 4, maxHeight: above }
          : { left, width: w, top: box.bottom + 4, maxHeight: below },
      );
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (panel.current) watcher?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      watcher?.disconnect();
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className="card popover overflow-y-auto"
      style={{
        position: "fixed",
        zIndex: 80,
        left: place?.left ?? 0,
        top: place?.top,
        bottom: place?.bottom,
        width: place?.width ?? width,
        maxHeight: place?.maxHeight,
        visibility: place ? "visible" : "hidden",
      }}
      data-testid={testId}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
