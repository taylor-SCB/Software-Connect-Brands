"use client";

import { useState, useTransition } from "react";
import { rewriteGreeting } from "./actions";

// My day's greeting (BDR redesign): the rule-written sentence is what
// shows. With AI on, "Rewrite" asks Claude for another wording of the same
// facts; it is shown in place, never saved, and "Use the plain one" puts
// the rule-written sentence back.
export function Greeting({ text, ai }: { text: string; ai: boolean }) {
  const [rewritten, setRewritten] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <h1 className="mt-1 text-xl font-semibold leading-snug sm:text-2xl" data-testid="my-day-greeting" data-source={rewritten ? "ai" : "rules"}>
        {rewritten ?? text}
      </h1>
      {ai && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          {rewritten ? (
            <button type="button" className="link min-h-11 sm:min-h-0" onClick={() => setRewritten(null)} data-testid="greeting-plain">
              Use the plain one
            </button>
          ) : (
            <button
              type="button"
              className="link min-h-11 sm:min-h-0"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await rewriteGreeting();
                  if ("error" in result) setError(result.error);
                  else setRewritten(result.sentence);
                })
              }
              data-testid="greeting-rewrite"
            >
              {pending ? "Rewriting…" : "Rewrite"}
            </button>
          )}
          {error && (
            <span className="text-[var(--danger)]" data-testid="greeting-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
