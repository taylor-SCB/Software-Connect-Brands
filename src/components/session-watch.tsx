"use client";

import { useEffect } from "react";

// Signs a tab out on its own (Nov 25, 2026, Taylor: "if it is open on his
// browser, I need to make sure it force logs him out"). Every page checks
// the login on each click already; this reaches the tab nobody is clicking
// in, and a page brought back by the Back button. It asks /api/session
// when the tab opens, about once a minute while it is in view, and
// whenever someone comes back to it. Turned away (removed, or the
// workspace paused): the browser goes to /session-ended, which wipes the
// login cookie and shows the login page with the reason. Signed out in
// another tab: the login page. Someone else signed in on this browser
// since: the page is drawn again for them.
const EVERY_MS = 60_000;
// Focus and visibility can fire together; one question is enough.
const MIN_GAP_MS = 5_000;

type Answer = { ok: true; userId: string } | { ok: false; reason: string | null };

export function SessionWatch({ userId }: { userId: string }) {
  useEffect(() => {
    let last = 0;
    let leaving = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function check(force: boolean) {
      if (leaving) return;
      const now = Date.now();
      if (!force && now - last < MIN_GAP_MS) return;
      last = now;
      let answer: Answer;
      try {
        const res = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) return;
        answer = (await res.json()) as Answer;
      } catch {
        // Offline, or the site mid-deploy: ask again next time.
        return;
      }
      if (leaving) return;
      if (answer.ok) {
        if (answer.userId !== userId) {
          leaving = true;
          window.location.reload();
        }
        return;
      }
      leaving = true;
      window.location.replace(answer.reason ? `/session-ended?reason=${answer.reason}` : "/login");
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    }
    function start() {
      stop();
      timer = setInterval(() => void check(true), EVERY_MS);
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        void check(false);
        start();
      } else {
        stop();
      }
    }
    function onShow(event: PageTransitionEvent) {
      // Brought back from the browser's page cache by Back or Forward.
      if (!event.persisted) return;
      leaving = false;
      void check(true);
    }

    void check(true);
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onShow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onShow);
    };
  }, [userId]);

  return null;
}
