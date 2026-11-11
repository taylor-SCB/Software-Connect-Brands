Contact page modules in src/app/dashboard/contacts/[id]/ that other screens can reuse:

- ContactShell({contactId, name, companyId, today, children}) and useContactPage(). The hook returns {contactId, name, firstName, companyId, today, logOpen, openLog() (opens the log and scrolls to #log), openLogHere(), closeLog(), armReturn() (after a tel:/sms: tap, opens the log when the page is looked at again), openBook(), showToast({message, batchId?, href?, hrefLabel?})}. The toast shows 'Saved · Undo' and calls undoLog.
- BookMeetingSheet({onClose}): must sit inside ContactShell. Choices come from bookingOptions; it saves with bookMeeting({contactId, on, time, withContactIds, where, note, opportunity}).
- useMeetingActions(meeting: ContactMeeting | null) → {held(early?), noShow(), move(on, time, after?), pending, error, confirm, cancelConfirm, canMark}. It routes to markMeetingHeld / markMeetingNoShow / rescheduleMeeting when there is a meetingId, to completeEventWithLog / moveEvent when there is only an eventId, and to logActivity MEETING+HELD when there is neither. EarlyConfirm and MoveButton({label, onMove(on, time, close), pending, testId, withTime}) go with it.
- loadContactMeetings(orgId, contactId, timeZone, now?) → {due, next}. ContactMeeting = {meetingId, eventId, on, time, when ('Tue 10:00 AM'), title, due}.
- MainAction({data: MainActionData, phones: PhoneRow[], variant: 'header' | 'bar'}), CallButton, TextButton, MoreMenu({contactId, contactName, linkedIds, status, meetingSetOn, today, addDeal?, testId?, buttonClassName?, label?}), NextStepStrip({due, next, first, park}), LogBar({children}), ContactHistory({items: HistoryItem[]}), PhoneBar({data, phones, more}).
- Sheet({title, subtitle, onClose, testId, children}) and Chip; Collapsible({title, subtitle, actions, id, testId}); Disclosure({label, openLabel, testId}); CopyButton({value, label}).
- day-chips.ts: dayChips(today), TIME_CHIPS, shiftDay, dayWords.

Shared components in src/components/ (old props unchanged, new ones optional):
- StatusPanel({kind, id, status, meetingSetOn, today, onDone}) from status-picker.tsx: the grouped picker contents with skipped-step dates and the Not Interested / Lost reason, for anyone putting 'Set status by hand' inside their own ⋯ menu. StatusPicker keeps its old props and testids (status-picker, status-menu, status-option-*, status-dates, status-date-*, status-save). New testids: status-reason, status-reason-<KEY>.
- ActivityFeed items take optional outcome, connect, paper {href, doc} and undoBatchId. Lines carry data-connect, data-outcome and testids activity-connect / activity-attempt / activity-paper / activity-delete.
- ActivityOverview takes bare?; tiles carry data-testid=activity-tile, data-label and data-value.
- UpcomingCard takes phoneFold?.
- AdditionalAccountButton takes open? and onOpenChange? (controlled, no button of its own) and now draws its dialog through a portal.
- ActivityDelete({batchId, others}) in src/components/activity-delete.tsx.

Key testids: contact-header, contact-main (data-action), contact-call, contact-call-more/-menu, contact-text, record-more/-menu, more-add-deal, show-counts, next-step (data-kind none / item / meeting / due), next-held, next-no-show, next-move, next-follow-up, next-park, log-bar, log-sheet, history, history-filter-*, history-count-*, history-day, reach, reach-toggle, more-details, good-to-know, paperwork, paperwork-more, paperwork-add-deal-open, book-sheet, book-day-<iso>, book-time-<HH:MM>, book-save, undo-toast, undo-toast-undo, phone-bar, phone-bar-{call,text,log,main,more}.