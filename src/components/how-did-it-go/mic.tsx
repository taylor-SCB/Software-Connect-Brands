"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// The mic on How did it go? (AI release A, Nov 12, 2026). The phone's own
// speech recognition turns what's said into words in the browser, and
// they appear in the notes box as they come. Nothing is recorded, stored
// or sent by us: only the words end up in the box, like typing. Where the
// browser has none, the button says to use the keyboard's mic and puts
// the cursor in the box.

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MicGlyph = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export function MicButton({ target, onWords, disabled }: { target: RefObject<HTMLTextAreaElement | null>; onWords: (text: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const live = useRef<Recognition | null>(null);

  useEffect(() => () => live.current?.abort(), []);

  function start() {
    const box = target.current;
    const Klass = recognitionClass();
    if (!Klass) {
      setHint("Use your keyboard's mic to dictate");
      box?.focus();
      return;
    }
    if (!box) return;
    const base = box.value.trim() ? `${box.value.trimEnd()} ` : "";
    const rec = new Klass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (event) => {
      let said = "";
      for (let i = 0; i < event.results.length; i += 1) said += event.results[i][0]?.transcript ?? "";
      box.value = `${base}${said.trim()}`.slice(0, 5000);
      onWords(box.value);
    };
    rec.onerror = (event) => {
      setHint(event.error === "not-allowed" || event.error === "service-not-allowed" ? "The mic isn't allowed here. Use your keyboard's mic to dictate." : "Didn't catch that. Try again, or use your keyboard's mic.");
    };
    rec.onend = () => {
      live.current = null;
      setListening(false);
    };
    try {
      rec.start();
      live.current = rec;
      setHint(null);
      setListening(true);
    } catch {
      setHint("Use your keyboard's mic to dictate");
      box.focus();
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => (listening ? live.current?.stop() : start())}
        disabled={disabled}
        aria-pressed={listening}
        className={`btn btn-sm min-h-11 sm:min-h-0 ${listening ? "btn-primary" : "btn-ghost"}`}
        data-testid="log-mic"
        data-listening={listening ? "" : undefined}
      >
        <MicGlyph size={13} />
        {listening ? "Listening… tap to stop" : "Say it"}
      </button>
      {hint && (
        <span className="faint text-xs" role="status" data-testid="log-mic-hint">
          {hint}
        </span>
      )}
    </span>
  );
}
