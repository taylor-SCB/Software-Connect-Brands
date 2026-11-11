"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { METER_STEPS, type LeadHealth, type MeterStep } from "@/lib/health";
import { FloatingMenu } from "@/components/floating-menu";
import { HealthDot } from "@/components/health-marks";
import { HealthDetails, useHoverPopover } from "@/components/health-popover";
import { Sheet } from "@/components/how-did-it-go/sheet";

// One lifecycle meter for every BDR screen (BDR redesign, Nov 11, 2026).
// Seven steps — Attempted, Connected, Meeting Set, Meeting Completed,
// Quote Sent, Contract Sent, Won. Its length is how far along someone is;
// its colour is how warm they are (leadHealth in src/lib/health.ts, loaded
// in batches by src/lib/health-load.ts). The next step is outlined and
// carries the one action; on the header size the current step breathes
// (never under reduced motion), and a step reached since the last render
// fills with a 300ms sweep. Interested is a notch on Connected. Won fills
// all seven with a check; Not Interested, Lost and Archived turn the
// reached steps grey with an × and the reason. role="img" with the whole
// story in its label: "Stage: Meeting Set, 3 of 7. Health: Cooling. Did
// the Nov 6 meeting happen?".
//
// size="header": contact, company and opportunity headers. Up to 640px,
// 10px steps with names and dates under them, the reason and a one-line
// caption; on a narrow card (a phone) the steps run full width at 8px and
// only the current and next step are named. Tapping a reached step says
// when it moved and who moved it; tapping the next step runs `onNext` or
// follows `nextHref` (Quote, Contract and Won are moved by the paperwork,
// so they say so instead).
//
// size="mini": list rows, Up next, company People rows, Pipeline tiles.
// Seven 10x5 steps, the health dot, "4 tries · 1 talk · 6d" under them;
// the whole cell is the tap target (44px tall on touch) and hover,
// long-press or focus opens every step with its date, the counts by type
// and the score breakdown. interactive={false} inside a link or a row
// that is itself clickable.
export function LifecycleMeter({
  health,
  size,
  showReason = true,
  showCaption = true,
  interactive = true,
  onNext,
  nextHref,
  className = "",
  testId = "lifecycle-meter",
}: {
  health: LeadHealth;
  size: "header" | "mini";
  // Header: the reason sentence and the caption under the steps.
  showReason?: boolean;
  // Mini: the counts under the steps.
  showCaption?: boolean;
  interactive?: boolean;
  onNext?: () => void;
  nextHref?: string;
  className?: string;
  testId?: string;
}) {
  const fresh = useFreshSteps(health.meter.won ? 6 : health.meter.closed ? -1 : health.meter.step);
  if (size === "mini") {
    return (
      <MiniMeter health={health} interactive={interactive} showCaption={showCaption} fresh={fresh} className={className} testId={testId} />
    );
  }
  return (
    <HeaderMeter
      health={health}
      interactive={interactive}
      showReason={showReason}
      onNext={onNext}
      nextHref={nextHref}
      fresh={fresh}
      className={className}
      testId={testId}
    />
  );
}

// Steps reached since the last render (a rep logs "Talked" and Connected
// fills): those sweep in once. Nothing sweeps on first paint.
function useFreshSteps(step: number) {
  const previous = useRef<number | null>(null);
  const [fresh, setFresh] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = step;
    if (before === null || step <= before) return;
    setFresh({ from: before + 1, to: step });
    const timer = setTimeout(() => setFresh(null), 400);
    return () => clearTimeout(timer);
  }, [step]);
  return fresh;
}

function Bars({ health, fresh, label }: { health: LeadHealth; fresh: { from: number; to: number } | null; label?: string }) {
  const meter = health.meter;
  return (
    <span
      className="lm-bars"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-testid="lifecycle-bars"
    >
      {meter.steps.map((step, index) => (
        <span
          key={step.name}
          className="lm-seg"
          data-state={step.state}
          data-step={index}
          data-interested={index === 1 && meter.interested ? "" : undefined}
          data-fresh={fresh && index >= fresh.from && index <= fresh.to ? "" : undefined}
        />
      ))}
    </span>
  );
}

function MiniMeter({
  health,
  interactive,
  showCaption,
  fresh,
  className,
  testId,
}: {
  health: LeadHealth;
  interactive: boolean;
  showCaption: boolean;
  fresh: { from: number; to: number } | null;
  className: string;
  testId: string;
}) {
  const { anchor, open, close, triggerProps, panelProps } = useHoverPopover<HTMLButtonElement>();
  const inner = (
    <>
      <Bars health={health} fresh={fresh} label={health.label} />
      <HealthDot health={health} />
      {showCaption && <span className="lm-mini-caption">{health.miniCaption}</span>}
    </>
  );
  const data = {
    "data-health": health.tone,
    "data-state": health.state,
    "data-step": health.meter.step,
    "data-testid": testId,
  };
  if (!interactive) {
    return (
      <span className={className ? `lm lm-mini ${className}` : "lm lm-mini"} {...data}>
        {inner}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className={className ? `lm lm-mini ${className}` : "lm lm-mini"}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...data}
        {...triggerProps}
      >
        {inner}
      </button>
      <FloatingMenu anchor={anchor} open={open} onClose={close} width={300} label="Where this stands" testId="lifecycle-popover">
        <div data-health-popover="" {...panelProps}>
          <HealthDetails health={health} steps />
        </div>
      </FloatingMenu>
    </>
  );
}

function HeaderMeter({
  health,
  interactive,
  showReason,
  onNext,
  nextHref,
  fresh,
  className,
  testId,
}: {
  health: LeadHealth;
  interactive: boolean;
  showReason: boolean;
  onNext?: () => void;
  nextHref?: string;
  fresh: { from: number; to: number } | null;
  className: string;
  testId: string;
}) {
  const meter = health.meter;
  const [shown, setShown] = useState<{ index: number; element: HTMLElement } | null>(null);
  // On a phone the step names are hidden; "All steps" opens every step
  // with its date in a bottom sheet (round 2, Nov 11, 2026).
  const [sheet, setSheet] = useState(false);
  // FloatingMenu places itself against a ref; one per opened step.
  const anchorRef = useMemo(() => ({ current: shown?.element ?? null }), [shown]);

  const phone = meter.closed ? (
    <>
      <b>{meter.closed.label}</b> after {METER_STEPS[meter.closed.at]}
    </>
  ) : meter.won ? (
    <>
      <b>✓ Won</b>
    </>
  ) : meter.current ? (
    <>
      <b>{meter.current}</b>
      {meter.interested ? " · Interested" : ""}
      {meter.nextStep ? ` → next: ${meter.nextStep}` : ""}
    </>
  ) : (
    <>
      <b>Not touched yet</b> → next: {METER_STEPS[0]}
    </>
  );

  return (
    <div
      className={className ? `lm lm-header ${className}` : "lm lm-header"}
      data-health={health.tone}
      data-state={health.state}
      data-step={meter.step}
      data-testid={testId}
    >
      <Bars health={health} fresh={fresh} label={health.label} />
      <ol className="lm-names" aria-label="Steps">
        {meter.steps.map((step, index) => (
          <li key={step.name} className="min-w-0">
            <StepName
              step={step}
              index={index}
              interestedMark={index === 1 && meter.interested}
              wonMark={index === 6 && meter.won}
              interactive={interactive}
              onNext={onNext}
              nextHref={nextHref}
              onShow={(element) => setShown(shown?.index === index ? null : { index, element })}
            />
          </li>
        ))}
      </ol>
      <div className="lm-phone">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p data-testid="lifecycle-phone">{phone}</p>
          {interactive && (
            <button
              type="button"
              className="link min-h-11 text-xs"
              aria-haspopup="dialog"
              aria-expanded={sheet}
              onClick={() => setSheet(true)}
              data-testid="lifecycle-steps-open"
            >
              All steps
            </button>
          )}
        </div>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="All steps" testId="lifecycle-steps-sheet">
        <div data-health={health.tone}>
        <ol className="space-y-1" aria-label="Steps">
          {meter.steps.map((step, index) => {
            const reached = step.state === "done" || step.state === "current" || step.state === "closed";
            return (
              <li
                key={step.name}
                className="flex min-h-11 items-start gap-3 border-b border-[var(--hairline-3)] py-2 last:border-b-0"
                data-testid="lifecycle-sheet-step"
                data-state={step.state}
                data-step={index}
              >
                <span
                  aria-hidden="true"
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border-strong)]"
                  style={reached ? { background: "var(--hc)", borderColor: "transparent" } : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    {index === 6 && meter.won ? "✓ " : ""}
                    {step.name}
                    {index === 1 && meter.interested ? " · Interested" : ""}
                    {step.state === "current" && <span className="faint font-normal"> · now</span>}
                    {step.state === "next" && <span className="faint font-normal"> · next</span>}
                  </span>
                  <span className="block text-xs text-[var(--text-dim)]" data-testid="lifecycle-sheet-date">
                    {reached
                      ? `${step.date ? `Reached ${step.date}` : "Reached"}${step.by === "auto" ? " · moved on its own" : step.by ? ` · by ${step.by}` : ""}`
                      : (step.hint ?? "Not yet")}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {showReason && (
          <p className="mt-3 text-sm" data-testid="lifecycle-sheet-reason">
            {health.reason}
          </p>
        )}
        </div>
      </Sheet>
      {meter.closed && !showReason && (
        <p className="lm-closed" data-testid="lifecycle-closed">
          <span className="lm-closed-mark" aria-hidden="true">
            ×
          </span>{" "}
          {meter.closed.label}
          {meter.closed.reason ? ` · ${meter.closed.reason}` : ""}
        </p>
      )}
      {showReason && (
        <>
          <p className="lm-reason" data-testid="lifecycle-reason">
            {meter.closed && (
              <span className="lm-closed-mark" aria-hidden="true">
                ×{" "}
              </span>
            )}
            {health.reason}
          </p>
          <p className="lm-caption" data-testid="lifecycle-caption">
            {health.caption}
            {health.collected ? ` · ${health.collected}` : ""}
          </p>
        </>
      )}
      {shown !== null && (
        <FloatingMenu
          anchor={anchorRef}
          open
          onClose={() => setShown(null)}
          width={260}
          label={meter.steps[shown.index].name}
          testId="lifecycle-step-popover"
        >
          <StepDetails step={meter.steps[shown.index]} />
        </FloatingMenu>
      )}
    </div>
  );
}

function StepName({
  step,
  index,
  interestedMark,
  wonMark,
  interactive,
  onNext,
  nextHref,
  onShow,
}: {
  step: MeterStep;
  index: number;
  interestedMark: boolean;
  wonMark: boolean;
  interactive: boolean;
  onNext?: () => void;
  nextHref?: string;
  onShow: (element: HTMLElement) => void;
}) {
  const reached = step.state === "done" || step.state === "current" || step.state === "closed";
  const words = (
    <>
      {wonMark && (
        <span className="lm-mark" aria-hidden="true">
          ✓{" "}
        </span>
      )}
      {step.name}
      {interestedMark ? " · Interested" : ""}
      {step.date && <span className="lm-date">{step.date}</span>}
    </>
  );
  const data = { "data-state": step.state, "data-step": index };
  if (!interactive || (!reached && step.state !== "next")) {
    return (
      <span className="lm-name block" {...data}>
        {words}
      </span>
    );
  }
  // The next step runs the one action, unless the paperwork moves it.
  if (step.state === "next" && !step.readOnly && (onNext || nextHref)) {
    if (nextHref) {
      return (
        <Link href={nextHref} className="lm-name block" aria-label={`Next: ${step.name}`} {...data}>
          {words}
        </Link>
      );
    }
    return (
      <button type="button" className="lm-name" aria-label={`Next: ${step.name}`} onClick={onNext} {...data}>
        {words}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="lm-name"
      aria-haspopup="dialog"
      aria-label={reached ? `${step.name}${step.date ? `, ${step.date}` : ""}: when it moved` : `Next: ${step.name}`}
      onClick={(event) => {
        event.stopPropagation();
        onShow(event.currentTarget);
      }}
      {...data}
    >
      {words}
    </button>
  );
}

function StepDetails({ step }: { step: MeterStep }) {
  const reached = step.state === "done" || step.state === "current" || step.state === "closed";
  return (
    <div className="health-details">
      <p className="health-details-reason">{step.name}</p>
      {reached ? (
        <p>
          {step.date ? `Reached ${step.date}` : "Reached"}
          {step.by === "auto" ? " · moved on its own" : step.by ? ` · by ${step.by}` : ""}
        </p>
      ) : (
        <p>{step.hint ?? "The next step"}</p>
      )}
    </div>
  );
}
