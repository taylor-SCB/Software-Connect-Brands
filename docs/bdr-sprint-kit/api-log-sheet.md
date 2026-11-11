import { HowDidItGo, useHowDidItGo, guessType, TYPE_ORDER, type HowDidItGoOptions, type HowEvent, type LogTargetProps } from "@/components/how-did-it-go/how-did-it-go"
- <HowDidItGo open onClose {...HowDidItGoOptions} onFinished?/>. It draws the sheet only while open, so it starts fresh each time, plus the 'Saved · Undo' toast, which outlives the sheet. onFinished fires once the sheet is closed and the toast has gone; use it when the host unmounts the component.
- HowDidItGoOptions = {
    target?: {contactId} | {companyId};
    event?: HowEvent (a calendar entry: {id, type, title, notes, startOn?, startTime?, contactId?, contactName?, companyId?, companyName?});
    type?: 'PHONE_CALL'|'TEXT'|'EMAIL'|'MEETING';
    name?; today?;
    current?: PickableContact (+ others);
    companyPeople?: CompanyPerson[]; userName? (company Who?);
    pickContactIds? (company: people ticked to start);
    start?: 'log'|'book' ('book' opens straight on the Meeting booked step);
    opportunityId? (the tile it was opened from, e.g. the Pipeline panel: a Meeting outcome answers that tile's meeting, a meeting logged or booked lands on it, and it is offered first);
    onSaved?(SavedLog {batchId, words, type, outcome, chip, opportunityId, note, at}) (a step-1 save that opens step 2);
    onChanged?() (anything written: every save, the next step, a booking, a reschedule, Not moving forward, and an Undo from the sheet or its toast; a host showing the same record reloads on it);
    onToast?(SheetToast {batchId, words, href, hrefLabel?, opportunityId}) (the host draws "Saved · Undo" itself, one toast slot per screen; the sheet then draws none)
  }
- "Pipeline →" on a toast is pipelineHref(opportunityId) from @/lib/pipeline-link: /dashboard/deals?open=<id>, the tile itself even past Mine. The words say "is on your Pipeline" only when the tile is the booker's ("the Pipeline" when a teammate's).
- const how = useHowDidItGo({ dial?: true, defaults?: HowDidItGoOptions }); call how.open(options), then how.close(), and render {how.element} once. With dial:true it also opens by itself for whoever a tapped tel:/sms: link names. Put data-contact-id on the row or on the link. `defaults` go into every opening (the dial's too); what open() is given wins.
- The meter's action.key mapping: 'call' → how.open({target:{contactId}, type:'PHONE_CALL'}). 'book' → useBookMeeting, or how.open({..., start:'book'}) (its label is "Reschedule" after a no-show with nothing booked). 'mark-held' → markMeetingHeld on the meeting waiting (waitingMeetings' `due`), and with none (Meeting Set with no meeting known) how.open({target:{contactId}, type:'MEETING'}); the sheet finds the meeting to answer (toAnswer) and uses markMeetingHeld / markMeetingNoShow, or logs one. Never draw a button for an action the screen can't run.
- Which meeting is waiting is one rule (src/lib/meeting-rule.ts, fed by waitingMeetings(orgId, {contactIds}|{opportunityIds}) in src/lib/meetings.ts): answered = the meeting's outcome, else its history line's; a calendar tick answers nothing; Do Not List is not on a tile; `ahead` = the soonest unanswered still to come; `due` = the latest gone by on a Meeting Set tile, unanswered, with nothing ahead; `missed` = the same when a no-show; `toAnswer` = the latest gone by unanswered, else ahead, else missed. Use it; don't write another.

import { BookMeetingSheet, useBookMeeting, BookMeetingFields, EMPTY_BOOKING, type BookingValue } from "@/components/book-meeting/book-meeting"
- <BookMeetingSheet open onClose contactId name? today? opportunityId? onBooked?({batchId, opportunityId, eventId, message}) onChanged? onToast?/>. It saves through bookMeeting and shows its own Undo toast (or hands it to onToast). opportunityId: the tile it was opened from, offered and picked first.
- const book = useBookMeeting({onBooked?, onChanged?, onToast?}); call book.open({contactId, name?, today?, opportunityId?}) and render {book.element}.
- <BookMeetingFields contactId today value onChange who? opportunity? offer? onChoices?/> is just the fields, for a custom sheet (offer: the host's tile, offered first).

import { useDialReturn } from "@/components/how-did-it-go/dial-return": useDialReturn({contactIds, companyId?, page?, any?, enabled?}, (tap: {type, contactId, companyId, at}) => …).
import { Sheet, Chip, ChipGrid } from "@/components/how-did-it-go/sheet": a portal bottom-sheet or dialog shell, and 44/56px chips. Sheet takes formRef / onSubmit / formTestId to make the body and the pinned footer one form.
import { UndoToast, UNDO_MS } from "@/components/how-did-it-go/undo-toast".
import { dayChips, TIME_CHIPS, whenWords, longDay, plusDays } from "@/components/how-did-it-go/dates" (pure). Every day and time picker uses these (the Pipeline's Reschedule, the panel's, the contact page's Move and Set follow-up), with a "No time" choice, starting at the meeting's own time.

Server actions ("use server", src/components/how-did-it-go/actions.ts):
- logContext({contactId?|companyId?|eventId?, opportunityId?}) → {today, contactId, companyId, name, firstName, companyName, park, tries, parkAfterTries, meeting:{id, eventId, on, time, ahead, noShow?}|null}
- afterLog({batchId, note?, mark?, reason?, next?: NextStep}) → {success, words[], opportunityId}|{error}. It writes into an existing save; only the person who logged it, or an Owner or Admin.
- notMovingForward({opportunityId?|batchId?, reason?}) → {success}|{error}
- rescheduleEntry(eventId, {on, time?}) → {success}|{error}
- bookingChoices(contactId, opportunityId?) → bookingOptions + {today, name} (includesThem: on it as Primary or Associated; the opportunityId's tile is always listed)

Changed shared components, all backwards-compatible:
- ContactMultiSelect takes an optional label.
- FollowUpPrompt takes optional batchId and testId; its Meeting tick reads 'Try to book a meeting'.
- CompanyPeoplePicker takes optional initial and onChange(ids, frontDesk). company-bypass-tick is now a role=checkbox chip.

Test ids for other suites:
- The bar is log-bar; quick buttons are log-bar-<TYPE>.
- Sheet: how-did-it-go (in the Done box: done-box). Form: log-activity-form (in the Done box: done-form).
- Chips and fields: log-type-<TYPE>, outcome-<KEY>, outcome-more, activity-when-toggle, activity-when, activity-time, activity-submit, log-note.
- After a save: log-saved / log-undo; next step follow-up-prompt, next-<choice>, next-day-<first|second|week|pick>, reason-<KEY>, mark-INTERESTED; follow-up-save / follow-up-skip; log-early-yes.
- Book meeting: book-day-*, book-days (data-days), book-time-HH:MM, book-who, book-opportunity (data-offered), book-opp-yes/new, book-submit. The meeting line: log-meeting-line (data-meeting-id).
- Toast: log-toast, log-toast-words, log-toast-undo, log-toast-link.