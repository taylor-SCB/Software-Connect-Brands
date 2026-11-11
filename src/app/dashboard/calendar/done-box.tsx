"use client";

import { useState } from "react";
import { HowDidItGo, guessType, type HowEvent } from "@/components/how-did-it-go/how-did-it-go";

export { guessType };

// Whether ticking this entry can write a line in somebody's history: it
// is with a contact or a company, is not done yet, and was not logged
// already (a call logged from the form arrives with its line attached).
export function canLogOnDone(event: {
  contactId: string | null;
  companyId: string | null;
  doneAt: string | null;
  activityId?: string | null;
}) {
  return Boolean(event.contactId || event.companyId) && !event.doneAt && !event.activityId;
}

// "How did it go?" — ticking a scheduled call or meeting done and logging
// it in one step (BDR redesign, Nov 11, 2026): the How did it go? sheet
// for this entry, with its outcome chips (a meeting: Held · No-show ·
// Rescheduled) and the next follow-up after, so the chain of follow-ups
// never ends here. "Log … and tick it" saves with no outcome (a meeting
// that has happened reads Held), and "Just tick it" keeps the old
// behaviour for a day that needs no line in anyone's history. It stays
// mounted, with the sheet closed, while its "Saved · Undo" shows.
export function DoneBox({ event, onClose }: { event: HowEvent; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return <HowDidItGo open={open} event={event} onClose={() => setOpen(false)} onFinished={onClose} />;
}
