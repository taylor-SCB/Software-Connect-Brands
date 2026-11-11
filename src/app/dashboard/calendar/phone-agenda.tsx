"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Phones open the calendar on the Agenda (BDR redesign, Nov 11, 2026): a
// Month grid is seven 50px squares on a phone. The server can't see the
// screen, so a bare /dashboard/calendar on a narrow screen swaps itself
// for the Agenda before anything else happens. Month stays one tap away.
export function PhoneAgenda() {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) router.replace("/dashboard/calendar?view=agenda");
  }, [router]);
  return null;
}
