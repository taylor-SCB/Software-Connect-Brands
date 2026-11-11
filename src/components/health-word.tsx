"use client";

import type { LeadHealth } from "@/lib/health";
import { FloatingMenu } from "@/components/floating-menu";
import { HealthDetails, useHoverPopover } from "@/components/health-popover";
import { HealthWordStatic } from "@/components/health-marks";

// The health word chip: "● Warm", "◐ Cooling", "▲ Cold", "○ Trying",
// "○ New", "✓ Won", "× Closed". The mark is in the health colour, the word
// in text colour. The 0-100 number lives only in the breakdown that
// hover, long-press or keyboard focus opens ("Recent 25 · Talk 30 · Next
// step 0 = 55"). Pass interactive={false} inside a link or a clickable
// row, where a button can't go.
export function HealthWord({
  health,
  interactive = true,
  className = "",
}: {
  health: LeadHealth;
  interactive?: boolean;
  className?: string;
}) {
  const { anchor, open, close, triggerProps, panelProps } = useHoverPopover<HTMLButtonElement>();
  if (!interactive) return <HealthWordStatic health={health} className={className} />;
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className={className ? `health-word ${className}` : "health-word"}
        data-health={health.tone}
        data-testid="health-word"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Health: ${health.word}. ${health.reason}${/[.?!]$/.test(health.reason) ? "" : "."} Show why`}
        {...triggerProps}
      >
        <span className="health-word-mark" aria-hidden="true">
          {health.mark}
        </span>
        {health.word}
      </button>
      <FloatingMenu anchor={anchor} open={open} onClose={close} width={300} label={`Why ${health.word}`} testId="health-popover">
        <div data-health-popover="" {...panelProps}>
          <HealthDetails health={health} />
        </div>
      </FloatingMenu>
    </>
  );
}
