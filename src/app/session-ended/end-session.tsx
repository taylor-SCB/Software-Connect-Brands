"use client";

import { useEffect, useRef } from "react";
import { endSession } from "./actions";

// Sends the sign-out as soon as the page is up. A form rather than a call,
// so the button still works before (or without) the JavaScript.
export function EndSession() {
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    form.current?.requestSubmit();
  }, []);
  return (
    <form ref={form} action={endSession} className="mt-4">
      <button type="submit" className="btn-primary w-full" data-testid="session-ended-continue">
        Continue to log in
      </button>
    </form>
  );
}
