import type { HealthTone } from "@/lib/health";
import type { JourneyState } from "@/lib/health-journey";
import { HealthDot } from "@/components/health-marks";

// DealJourney (BDR redesign, Release 8): the lifecycle meter carried on to
// the money, on the quote, the Contract Coordinator, the contract and the
// opportunity panel. Meeting ✓ · Quote ✓ Nov 10 · Contract ● sent Nov 10 ·
// Signed ○ · Deposit ○, with one Next slot the page fills with its own
// button (dealJourney() in src/lib/health-journey.ts names it: Send quote
// → Customer said yes → Make contract → Send for signature → Copy signing
// link → Send deposit invoice). The badges a page shows today go in
// `details`, a row under the strip. On a narrow card it collapses to five
// dots and "Step 3 of 5 · Contract sent Nov 10" with the Next button full
// width; `stickyNext` pins it to the foot of a phone screen. No hooks:
// renders from server and client components alike.
export function DealJourney({
  journey,
  next,
  details,
  tone = "good",
  stickyNext = false,
  label = "Deal progress",
  testId = "deal-journey",
}: {
  journey: JourneyState;
  next?: React.ReactNode;
  details?: React.ReactNode;
  tone?: HealthTone;
  stickyNext?: boolean;
  label?: string;
  testId?: string;
}) {
  const spoken = journey.steps
    .map((step) => `${step.name} ${step.state === "done" ? "done" : step.state === "current" ? "next" : "to come"}${step.note ? ` (${step.note})` : ""}`)
    .join(", ");
  return (
    <section className="dj lm" data-health={tone} data-current={journey.current} data-testid={testId} aria-label={label}>
      <div className="dj-row">
        <ol className="dj-steps" role="img" aria-label={`${label}: ${spoken}`}>
          {journey.steps.map((step) => (
            <li key={step.name} className="dj-step" data-state={step.state} aria-hidden="true">
              <span className="lm-seg" data-state={step.state === "current" ? "next" : step.state} />
              <span>
                <span className="lm-mark">{step.state === "done" ? "✓" : step.state === "current" ? "●" : "○"}</span> {step.name}
                {step.note && <span className="dj-step-note">{step.note}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="dj-dots" data-testid="deal-journey-summary">
          {journey.steps.map((step) => (
            <HealthDot key={step.name} tone={step.state === "todo" ? "none" : tone} hollow={step.state !== "done"} />
          ))}
          <span>{journey.summary}</span>
        </p>
        {next && (
          <div className="dj-next" data-sticky={stickyNext ? "" : undefined}>
            {next}
          </div>
        )}
      </div>
      {details && <div className="flex flex-wrap items-center gap-2">{details}</div>}
    </section>
  );
}
