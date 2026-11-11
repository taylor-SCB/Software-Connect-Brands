Server actions:
- `undoClaim({ batchId, activityIds, contactId, companyId })` → `ActionState`, in `src/app/dashboard/companies/[id]/claim-actions.ts`. It takes one claim back. Only whoever claimed, or an Owner or Admin, can do it.
- `claimActivities(...)` in `companies/actions.ts` now returns `{ success, batchId }`.

Client pieces, all in `src/app/dashboard/companies/[id]/`:
- `CompanyShell({ companyId, companyName, people: {id,name,title}[], companyPeople, userName?, today, children })` and `useCompanyShell()` → `{ book(contactId?), logOpen, setLogOpen, openLog(type?), moreOpen, setMoreOpen, openMore, rowLog, setRowLog(id, type?), saved({ message, batchId?, href? }) }`. Since the merge (Nov 11, 2026) the shell draws the shared How did it go? sheet (on the company for Log a touch, on a person for a row) and the shared Book meeting sheet; `saved` shows the page's own "Saved · Undo" (undoLog) for its own saves and refreshes the page.
- `HeaderActions({ action: MainAction, health, mainLine, email, more, children })` and the `MainAction` union (call, book, meeting, mark-held, link, copy, log).
- `WhoToCall({ rows: CallRow[], total, page, pages, companyId, companyName, today, nudge })`.
- From `sections.tsx`: `LogTouch`, `FoldCard({ title, subtitle, mode: 'phone' | 'closed', defaultOpen, actions, id, testId })`, `ShowCounts`, `HistoryShell` / `HistoryChunk`, `NextStepStrip`, `PhoneBar({ mainLine, bookFor })`.

Loaders in `load.ts` (take organizationId, batched):
- `whoToCallPage(org, companyId, linkedIds, page, perPage)`
- `lastTouchLines(org, ids, healthMap, timeZone, now)` → `Map<id, 'Last: VM · 3d · 2 tries'>`
- `mainContactIds(org, ids)`
- `openOpportunities(org, companyId)` → `{ list, total }`
- `meetingFor(org, contactId, now, today)` → `{ pastMeetingId, aheadMeetingId, entryId }`
- `stageOrder(status)`

Test ids:
- Header: company-header, company-main (with data-action), company-call-main, company-email, company-more, company-more-tray, company-meter, company-reached, company-show-counts, company-counts, company-owes, company-rep.
- Who to call: person-row (data-contact-id), person-name, person-meter, person-last, main-contact, person-call (number links), person-call-button, person-text, person-log-button (opens the shared sheet for that person), person-book, who-show-all.
- Not-linked line: other-contacts, not-linked-toggle, not-linked-count, claim-done, claim-undo. The old bypass-group, claim-one, claim-all and claim-box ids are kept.
- Book sheet: the shared one (book-meeting, book-day-*, book-time-<HH:MM>, book-who for who else, book-opportunity, book-opp-yes / book-opp-new, book-submit, its own log-toast); the stand-in and its testids were removed at the merge.
- Sections: company-saved, company-saved-undo, company-log-toggle (#log; opens the shared sheet on the company), company-next-step, company-opportunity, opportunity-open, good-to-know, company-paperwork, company-details (-toggle), company-notes-toggle, company-phone-bar, phone-bar-call / -log / -book / -more.

`#people`, `#activity`, `#notes` and `#log` keep their ids.