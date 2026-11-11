"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// One Save for the quote editor (ux-gaps' quote gap, Nov 11, 2026). The
// Line items, Payment table and Quote details cards each had their own
// Save; now each card reports whether it has unsaved edits and how to save
// itself, and one bar saves whatever is unsaved, in page order — the lines
// first, because the payment table prices against the lines as saved. Each
// card still saves through its own server action, so every server check
// stays exactly where it was, and each shows its own refusal in place. A
// refusal stops the run there, so nothing after it saves on top of a
// half-saved quote.

type Meta = { label: string; order: number; dirty: boolean; pending: boolean };
type SaveFn = () => Promise<boolean>;

type Registry = {
  meta: Record<string, Meta>;
  setMeta: (key: string, meta: Meta | null) => void;
  saves: React.MutableRefObject<Map<string, SaveFn>>;
};

const QuoteSave = createContext<Registry | null>(null);

export function QuoteSaveProvider({ children }: { children: React.ReactNode }) {
  const [meta, setAll] = useState<Record<string, Meta>>({});
  const saves = useRef(new Map<string, SaveFn>());
  const setMeta = useCallback((key: string, next: Meta | null) => {
    setAll((current) => {
      if (next === null) {
        if (!(key in current)) return current;
        const rest = { ...current };
        delete rest[key];
        return rest;
      }
      const was = current[key];
      if (was && was.label === next.label && was.order === next.order && was.dirty === next.dirty && was.pending === next.pending) return current;
      return { ...current, [key]: next };
    });
  }, []);
  const value = useMemo(() => ({ meta, setMeta, saves }), [meta, setMeta]);
  return <QuoteSave.Provider value={value}>{children}</QuoteSave.Provider>;
}

// A card joins the one Save. `save` resolves true when it saved (or had
// nothing to save) and false when it was refused.
export function useQuoteSaveSection(key: string, section: Meta & { save: SaveFn }) {
  const registry = useContext(QuoteSave);
  const { label, order, dirty, pending, save } = section;
  useEffect(() => {
    registry?.saves.current.set(key, save);
  });
  const setMeta = registry?.setMeta;
  useEffect(() => {
    setMeta?.(key, { label, order, dirty, pending });
  }, [setMeta, key, label, order, dirty, pending]);
  useEffect(() => {
    const saves = registry?.saves.current;
    return () => {
      setMeta?.(key, null);
      saves?.delete(key);
    };
  }, [registry, setMeta, key]);
  return Boolean(registry);
}

export function useQuoteSaveAll() {
  const registry = useContext(QuoteSave);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sections = Object.entries(registry?.meta ?? {}).sort((a, b) => a[1].order - b[1].order);
  const unsaved = sections.filter(([, meta]) => meta.dirty).map(([, meta]) => meta.label);
  const pending = running || sections.some(([, meta]) => meta.pending);

  const saveAll = useCallback(async () => {
    if (!registry) return;
    setRunning(true);
    setProblem(null);
    try {
      const order = Object.entries(registry.meta).sort((a, b) => a[1].order - b[1].order);
      for (const [key, meta] of order) {
        if (!meta.dirty) continue;
        const save = registry.saves.current.get(key);
        if (!save) continue;
        const ok = await save();
        if (!ok) {
          setProblem(`${meta.label} wasn't saved — see the message there.`);
          return;
        }
      }
    } finally {
      setRunning(false);
    }
  }, [registry]);

  return { enabled: Boolean(registry), unsaved, pending, problem, saveAll };
}

// The bar on a desktop: pinned to the foot of the window while the quote
// scrolls. (A phone has the Line items card's pinned bar with the total,
// whose Save is this same one.)
export function QuoteSaveBar() {
  const { enabled, unsaved, pending, problem, saveAll } = useQuoteSaveAll();
  if (!enabled) return null;
  return (
    <div
      className="popover sticky bottom-0 z-30 mt-5 flex items-center justify-end gap-3 rounded-t-xl border-t border-[var(--hairline-3)] px-5 py-3 max-sm:hidden"
      data-testid="quote-save-bar"
    >
      <p className="mr-auto min-w-0 truncate text-sm" role="status" data-testid="quote-save-status">
        {problem ? (
          <span className="text-[var(--danger)]">{problem}</span>
        ) : pending ? (
          <span className="faint">Saving…</span>
        ) : unsaved.length ? (
          <>
            <span className="faint">Unsaved changes: </span>
            {unsaved.join(" · ")}
          </>
        ) : (
          <span className="faint">All changes saved</span>
        )}
      </p>
      <button type="button" onClick={saveAll} disabled={pending || unsaved.length === 0} className="btn btn-primary btn-sm" data-testid="quote-save">
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
