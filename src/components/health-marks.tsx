import type { HealthState, HealthTone, LeadHealth } from "@/lib/health";

// The small health marks (BDR redesign, Nov 11, 2026). No hooks, so they
// render from server and client components alike. Colours are the fixed
// --health-* tokens (globals.css), never the tenant's brand; colour is
// never the only signal, so a dot or ring always sits beside a word or a
// reason sentence written in text colours.

type HealthLike = Pick<LeadHealth, "tone" | "state" | "word">;

// New and Trying draw as outlines: nobody has been reached yet.
export function isHollow(state: HealthState) {
  return state === "NEW" || state === "TRYING";
}

// An 8px dot in the health colour, for list rows, Up next, People rows and
// tiles. Decorative unless given a label.
export function HealthDot({
  health,
  tone,
  hollow,
  label,
  className = "",
}: {
  health?: HealthLike;
  tone?: HealthTone;
  hollow?: boolean;
  // When the dot stands for something on its own, e.g. "Health: Cooling".
  label?: string;
  className?: string;
}) {
  const t = tone ?? health?.tone ?? "none";
  const h = hollow ?? (health ? isHollow(health.state) : false);
  return (
    <span
      className={className ? `health-dot ${className}` : "health-dot"}
      data-health={t}
      data-hollow={h ? "" : undefined}
      data-testid="health-dot"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

// A 3px ring in the health colour around an avatar or a logo, for the
// contact, company and opportunity headers. Dashed for New and Trying.
export function HealthRing({
  health,
  tone,
  hollow,
  children,
  className = "",
}: {
  health?: HealthLike;
  tone?: HealthTone;
  hollow?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const t = tone ?? health?.tone ?? "none";
  const h = hollow ?? (health ? isHollow(health.state) : false);
  return (
    <span
      className={className ? `health-ring ${className}` : "health-ring"}
      data-health={t}
      data-hollow={h ? "" : undefined}
      data-testid="health-ring"
      title={health ? health.word : undefined}
    >
      {children}
    </span>
  );
}

// "● Warm" without the breakdown, for places that can't hold a popover
// (inside a link, a printed page). <HealthWord> is the interactive one.
export function HealthWordStatic({ health, className = "" }: { health: Pick<LeadHealth, "tone" | "word" | "mark">; className?: string }) {
  return (
    <span className={className ? `health-word ${className}` : "health-word"} data-health={health.tone} data-testid="health-word">
      <span className="health-word-mark" aria-hidden="true">
        {health.mark}
      </span>
      {health.word}
    </span>
  );
}
