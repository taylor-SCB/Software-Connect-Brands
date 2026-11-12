"use client";

import { firstSentence } from "@/lib/reports/first-sentence";
import { useEffect, useState, useTransition } from "react";
import { narrativeAction } from "./actions";

// The write-up at the top of a report. It arrives with the page; when AI is
// on and this set of numbers has no write-up yet, the page sends the rules
// version and this asks for the AI one straight after, so the page never
// waits on it. Rewrite asks again. The page keys it by the write-up's own
// key, so a new report or period starts it afresh.

export function NarrativeCard({
  body,
  source,
  pending,
  choice,
  fold = false,
}: {
  body: string;
  source: "CLAUDE" | "RULES";
  pending: boolean;
  choice: { report: string; period: string; rep: string; by: string };
  // The Daily Rundown (BDR redesign, Round 2): one headline sentence, the
  // rest behind "Read more". The words are all still on the page.
  fold?: boolean;
}) {
  const [text, setText] = useState(body);
  const [from, setFrom] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const [writing, start] = useTransition();
  const [waiting, setWaiting] = useState(pending);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    narrativeAction(choice).then((result) => {
      if (!live) return;
      setWaiting(false);
      if ("error" in result) return;
      setText(result.body);
      setFrom(result.source);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  function rewrite() {
    setError(null);
    start(async () => {
      const result = await narrativeAction({ ...choice, force: true });
      if ("error" in result) setError(result.error);
      else {
        setText(result.body);
        setFrom(result.source);
      }
    });
  }

  return (
    <section className="card card-lit p-5" data-testid="report-narrative" data-source={from} aria-busy={waiting || writing}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="eyebrow">The short version</p>
        <div className="flex items-center gap-2">
          <span className="faint text-[0.68rem]" data-testid="report-narrative-source">
            {waiting || writing ? "Writing…" : from === "CLAUDE" ? "Written by AI from these numbers" : "Written from these numbers"}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={rewrite} disabled={writing} data-testid="report-rewrite">
            Rewrite
          </button>
        </div>
      </div>
      <div className={`space-y-2 text-[0.92rem] leading-relaxed ${waiting || writing ? "opacity-70" : ""}`} data-testid="report-narrative-body">
        {fold ? <Folded text={text} /> : text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </section>
  );
}

// The first sentence, then the rest behind "Read more".
function Folded({ text }: { text: string }) {
  const trimmed = text.trim();
  const head = firstSentence(trimmed);
  const rest = trimmed.slice(head.length).trim();
  return (
    <>
      <p className="font-medium" data-testid="report-narrative-headline">
        {head}
      </p>
      {rest && (
        <details data-testid="report-narrative-more">
          <summary className="link inline-flex min-h-11 cursor-pointer items-center text-xs sm:min-h-0">Read more</summary>
          <div className="mt-2 space-y-2">
            {rest.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
