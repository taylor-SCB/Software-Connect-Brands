"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import type { LeadHealth } from "@/lib/health";

// Hover, long-press or keyboard focus opens a small panel; a click or tap
// pins it open (BDR redesign: "the number only on hover, long-press or
// keyboard focus, as a breakdown"). The panel itself is a FloatingMenu,
// drawn on document.body and kept on screen; Escape and a click elsewhere
// close it.
export function useHoverPopover<T extends HTMLElement>() {
  const anchor = useRef<T | null>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const longPressed = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = (timer: { current: ReturnType<typeof setTimeout> | null }) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      clear(hoverTimer);
      clear(pressTimer);
    },
    [],
  );

  const close = useCallback(() => {
    pinned.current = false;
    clear(hoverTimer);
    setOpen(false);
  }, []);

  const canHover = () => typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches;

  const triggerProps = {
    onMouseEnter() {
      if (!canHover()) return;
      clear(hoverTimer);
      hoverTimer.current = setTimeout(() => setOpen(true), 180);
    },
    onMouseLeave() {
      clear(hoverTimer);
      if (pinned.current) return;
      hoverTimer.current = setTimeout(() => setOpen(false), 160);
    },
    onFocus(event: FocusEvent<T>) {
      // Keyboard focus only: a mouse click focuses too, and that is the
      // click's job.
      try {
        if (event.currentTarget.matches(":focus-visible")) setOpen(true);
      } catch {
        /* an old browser without :focus-visible */
      }
    },
    onBlur(event: FocusEvent<T>) {
      const to = event.relatedTarget as Node | null;
      if (to && document.querySelector("[data-health-popover]")?.contains(to)) return;
      if (!pinned.current) setOpen(false);
    },
    onPointerDown(event: PointerEvent<T>) {
      if (event.pointerType !== "touch") return;
      longPressed.current = false;
      clear(pressTimer);
      pressTimer.current = setTimeout(() => {
        longPressed.current = true;
        pinned.current = true;
        setOpen(true);
      }, 450);
    },
    onPointerUp() {
      clear(pressTimer);
    },
    onPointerCancel() {
      clear(pressTimer);
    },
    onContextMenu(event: MouseEvent<T>) {
      // A long-press on a phone would also open the browser's own menu.
      if (longPressed.current) event.preventDefault();
    },
    onClick(event: MouseEvent<T>) {
      event.stopPropagation();
      if (longPressed.current) {
        longPressed.current = false;
        event.preventDefault();
        return;
      }
      clear(hoverTimer);
      if (open && pinned.current) {
        close();
      } else {
        pinned.current = true;
        setOpen(true);
      }
    },
  };

  // Keeps the panel open while the pointer is over it.
  const panelProps = {
    onMouseEnter() {
      clear(hoverTimer);
    },
    onMouseLeave() {
      if (pinned.current) return;
      hoverTimer.current = setTimeout(() => setOpen(false), 160);
    },
  };

  return { anchor, open, close, triggerProps, panelProps };
}

// What the panel says: the word and reason, the score breakdown (or why
// there is none), the seven steps with their dates, and the counts by type.
export function HealthDetails({ health, steps = false }: { health: LeadHealth; steps?: boolean }) {
  const byType = health.counts.byType;
  const typeBits = byType
    ? [
        byType.calls ? `${byType.calls} ${byType.calls === 1 ? "call" : "calls"}` : null,
        byType.texts ? `${byType.texts} ${byType.texts === 1 ? "text" : "texts"}` : null,
        byType.emails ? `${byType.emails} ${byType.emails === 1 ? "email" : "emails"}` : null,
        byType.meetings ? `${byType.meetings} ${byType.meetings === 1 ? "meeting" : "meetings"}` : null,
      ].filter(Boolean)
    : [];
  return (
    <div className="health-details" data-health={health.tone} data-testid="health-details">
      <p>
        <span className="health-word-mark" aria-hidden="true">
          {health.mark}
        </span>{" "}
        <span className="health-details-score">{health.word}</span>
      </p>
      <p className="health-details-reason">{health.reason}</p>
      {health.breakdown ? (
        <p className="health-details-score" data-testid="health-breakdown">
          {health.breakdown}
        </p>
      ) : health.state === "NEW" || health.state === "TRYING" ? (
        <p>No score until someone is reached.</p>
      ) : null}
      {health.collected && <p>{health.collected}</p>}
      {steps && (
        <ol className="health-details-steps">
          {health.meter.steps.map((step) => (
            <li key={step.name} data-reached={step.state === "done" || step.state === "current" || step.state === "closed" ? "" : undefined}>
              <span>{step.name}</span>
              <span>{step.date ?? (step.state === "next" ? "next" : "")}</span>
            </li>
          ))}
        </ol>
      )}
      {(typeBits.length > 0 || health.caption) && <p>{typeBits.length > 0 ? typeBits.join(" · ") : health.caption}</p>}
    </div>
  );
}
