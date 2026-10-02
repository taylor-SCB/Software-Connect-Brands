"use client";

import { useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { FormError } from "@/components/ui";
import { writeBriefingAction } from "@/app/dashboard/contacts/ai-actions";

// "Before you call" on a contact's page (Oct 2, 2026). The facts are always
// there, grouped by every company the person is part of. The paragraph is
// the AI's, written on request from exactly those facts and kept until they
// change — "Write it again" appears once something has moved.
export function BeforeYouCall({
  contactId,
  groups,
  paragraph: stored,
  stale,
  aiReady,
}: {
  contactId: string;
  groups: { company: string | null; main: boolean; lines: string[] }[];
  paragraph: string | null;
  stale: boolean;
  aiReady: boolean;
}) {
  const [paragraph, setParagraph] = useState(stored);
  const [fresh, setFresh] = useState(!stale);
  const [error, setError] = useState<string | undefined>();
  const [showFacts, setShowFacts] = useState(!stored);
  const [pending, start] = useTransition();

  function write() {
    setError(undefined);
    start(async () => {
      const result = await writeBriefingAction(contactId);
      if (result.error) setError(result.error);
      else if (result.paragraph) {
        setParagraph(result.paragraph);
        setFresh(true);
        setShowFacts(false);
      }
    });
  }

  const anything = groups.some((group) => group.lines.length > 0);

  return (
    <div className="p-5" data-testid="before-you-call">
      {paragraph && (
        <p className="text-sm leading-relaxed" data-testid="briefing-paragraph">
          {paragraph}
        </p>
      )}
      {paragraph && !fresh && <p className="faint mt-1 text-xs">Something has changed since this was written.</p>}
      <FormError message={error} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {aiReady && (
          <button type="button" onClick={write} disabled={pending} className="btn btn-ghost btn-sm" data-testid="briefing-write">
            <IconSparkles size={13} />
            {pending ? "Writing…" : paragraph ? (fresh ? "Write it again" : "Bring it up to date") : "Write a briefing"}
          </button>
        )}
        {paragraph && (
          <button type="button" onClick={() => setShowFacts(!showFacts)} className="btn btn-ghost btn-sm">
            {showFacts ? "Hide the facts" : "Show the facts"}
          </button>
        )}
      </div>
      {showFacts && (
        <div className="mt-3 space-y-3" data-testid="briefing-facts">
          {!anything && <p className="faint text-xs">Nothing on file with them yet beyond their details.</p>}
          {groups.map((group, index) =>
            group.lines.length === 0 ? null : (
              <div key={group.company ?? index}>
                {group.company && (
                  <p className="eyebrow mb-1">
                    {group.company}
                    {group.main ? "" : " · additional account"}
                  </p>
                )}
                <ul className="space-y-0.5 text-xs">
                  {group.lines.map((line) => (
                    <li key={line} className="muted">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
