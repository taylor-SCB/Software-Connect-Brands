Server actions:
- `undoClaim({ batchId, activityIds, contactId, companyId })` → `ActionState`, in `src/app/dashboard/companies/[id]/claim-actions.ts`. It takes one claim back. Only whoever claimed, or an Owner or Admin, can do it.
- `claimActivities(...)` in `companies/actions.ts` now returns `{ success, batchId }`.

Client pieces, all in `src/app/dashboard/companies/[id]/`:
- `CompanyShell({ people: {id,name,title}[], today, children })` and `useCompanyShell()` → `{ book(contactId?), logOpen, setLogOpen, openLog, moreOpen, setMoreOpen, openMore, rowLog, setRowLog, saved({ message, batchId?, href? }) }`. `saved` shows "Saved · Undo" (undoLog) and refreshes the page.
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
- Who to call: person-row (data-contact-id), person-name, person-meter, person-last, main-contact, person-call (number links), person-call-button, person-text, person-log-button, person-log, person-book, who-show-all.
- Not-linked line: other-contacts, not-linked-toggle, not-linked-count, claim-done, claim-undo. The old bypass-group, claim-one, claim-all and claim-box ids are kept.
- Book sheet: book-sheet, book-who, book-day, book-time, book-with, book-join-yes, book-join-new, book-save.
- Sections: company-saved, company-saved-undo, company-log-toggle (#log), company-next-step, company-opportunity, opportunity-open, good-to-know, company-paperwork, company-details (-toggle), company-notes-toggle, company-phone-bar, phone-bar-call / -log / -book / -more.

`#people`, `#activity`, `#notes` and `#log` keep their ids.