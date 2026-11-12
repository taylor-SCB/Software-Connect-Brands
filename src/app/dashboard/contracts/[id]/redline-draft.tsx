"use client";

import { createContext, useContext, useState } from "react";

// The wording the redline reader put together, waiting in the body editor
// until Save (Release B). Shared between the reader card and the Agreement
// card through the page's client tree, so pulling a sent contract back to
// draft (the page re-renders) keeps it.
type Draft = { body: string; version: number; applied: number } | null;
type Value = { draft: Draft; setDraft: (body: string, applied: number) => void; clearDraft: () => void };

const RedlineDraftContext = createContext<Value>({ draft: null, setDraft: () => {}, clearDraft: () => {} });

export function RedlineDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setState] = useState<Draft>(null);
  return (
    <RedlineDraftContext.Provider
      value={{
        draft,
        setDraft: (body, applied) => setState((current) => ({ body, applied, version: (current?.version ?? 0) + 1 })),
        clearDraft: () => setState(null),
      }}
    >
      {children}
    </RedlineDraftContext.Provider>
  );
}

export function useRedlineDraft() {
  return useContext(RedlineDraftContext);
}
