"use client";

import { useEffect, useState } from "react";

// Debounced fetch for the type-to-search pickers. Every picker in the app
// used to receive every row; at a few hundred thousand contacts that is a
// page that never loads, so they ask the server for the ten best matches
// instead. The most recent request wins; stale responses are dropped.
// Results are keyed by the url they answer, so a closed picker (url null)
// simply reads as empty without any state churn.
export function useSearch<T>(url: string | null, delayMs = 150): { results: T[]; loading: boolean } {
  const [answer, setAnswer] = useState<{ url: string; results: T[] } | null>(null);

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let results: T[] = [];
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        results = response.ok ? ((await response.json()) as T[]) : [];
      } catch {
        results = [];
      }
      if (!cancelled) setAnswer({ url, results });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url, delayMs]);

  if (url === null) return { results: [], loading: false };
  const fresh = answer?.url === url;
  // While a new query is in flight the previous answer stays on screen,
  // so a list does not flash empty between keystrokes.
  return { results: answer?.results ?? [], loading: !fresh };
}
