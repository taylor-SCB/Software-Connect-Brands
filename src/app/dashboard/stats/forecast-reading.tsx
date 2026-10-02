"use client";

import { useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { FormError } from "@/components/ui";
import { readForecastAction } from "./actions";

// The AI reading the forecast back in three sentences, on request.
export function ForecastReading({ repIds, stored, aiReady }: { repIds: string[]; stored: string | null; aiReady: boolean }) {
  const [reading, setReading] = useState(stored);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  if (!aiReady && !reading) return null;
  return (
    <div className="mb-4" data-testid="forecast-reading">
      {reading && <p className="text-sm leading-relaxed">{reading}</p>}
      <FormError message={error} />
      {aiReady && !reading && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const result = await readForecastAction(repIds);
              if (result.error) setError(result.error);
              else setReading(result.reading ?? null);
            })
          }
          className="btn btn-ghost btn-sm"
          data-testid="forecast-read"
        >
          <IconSparkles size={13} />
          {pending ? "Reading…" : "Read it to me"}
        </button>
      )}
    </div>
  );
}
