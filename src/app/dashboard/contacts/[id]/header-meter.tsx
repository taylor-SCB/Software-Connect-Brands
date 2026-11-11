"use client";

import { LifecycleMeter } from "@/components/lifecycle-meter";
import type { LeadHealth } from "@/lib/health";

// The full meter on the contact header. Tapping the next step runs the
// same action as the main button beside it (Call, Book meeting, Mark held,
// Start a quote …); a meeting still ahead has nothing to run.
export function HeaderMeter({ health }: { health: LeadHealth }) {
  const key = health.meter.action?.key;
  const runs = Boolean(key) && key !== "meeting";
  return (
    <LifecycleMeter
      health={health}
      size="header"
      className="mt-4"
      onNext={runs ? () => document.querySelector<HTMLElement>("[data-testid=contact-main]")?.click() : undefined}
    />
  );
}
