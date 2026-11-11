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
    onSaved?(SavedLog {batchId, words, type, outcome, chip, opportunityId, note, at})
  }
- const how = useHowDidItGo({ dial?: true }); call how.open(options), then how.close(), and render {how.element} once. With dial:true it also opens by itself for whoever a tapped tel:/sms: link names. Put data-contact-id on the row or on the link.
- The meter's action.key mapping: 'call' → how.open({target:{contactId}, type:'PHONE_CALL'}). 'book' → useBookMeeting, or how.open({..., start:'book'}). 'mark-held' on a contact → how.open({target:{contactId}, type:'MEETING'}); the sheet finds the waiting meeting and uses markMeetingHeld / markMeetingNoShow.

import { BookMeetingSheet, useBookMeeting, BookMeetingFields, EMPTY_BOOKING, type BookingValue } from "@/components/book-meeting/book-meeting"
- <BookMeetingSheet open onClose contactId name? today? onBooked?({batchId, opportunityId, eventId, message})/>. It saves through bookMeeting and shows its own Undo toast.
- const book = useBookMeeting({onBooked?}); call book.open({contactId, name?, today?}) and render {book.element}.
- <BookMeetingFields contactId today value onChange who? opportunity? onChoices?/> is just the fields, for a custom sheet.

import { useDialReturn } from "@/components/how-did-it-go/dial-return": useDialReturn({contactIds, companyId?, page?, any?, enabled?}, (tap: {type, contactId, companyId, at}) => …).
import { Sheet, Chip, ChipGrid } from "@/components/how-did-it-go/sheet": a portal bottom-sheet or dialog shell, and 44/56px chips. Sheet takes formRef / onSubmit / formTestId to make the body and the pinned footer one form.
import { UndoToast, UNDO_MS } from "@/components/how-did-it-go/undo-toast".
import { dayChips, TIME_CHIPS, whenWords, longDay, plusDays } from "@/components/how-did-it-go/dates" (pure).

Server actions ("use server", src/components/how-did-it-go/actions.ts):
- logContext({contactId?|companyId?|eventId?}) → {today, contactId, companyId, name, firstName, companyName, park, tries, parkAfterTries, meeting:{id, eventId, on, time, ahead}|null}
- afterLog({batchId, note?, mark?, reason?, next?: NextStep}) → {success, words[], opportunityId}|{error}. It writes into an existing save; only the person who logged it, or an Owner or Admin.
- notMovingForward({opportunityId?|batchId?, reason?}) → {success}|{error}
- rescheduleEntry(eventId, {on, time?}) → {success}|{error}
- bookingChoices(contactId) → bookingOptions + {today, name}

Changed shared components, all backwards-compatible:
- ContactMultiSelect takes an optional label.
- FollowUpPrompt takes optional batchId and testId; its Meeting tick reads 'Try to book a meeting'.
- CompanyPeoplePicker takes optional initial and onChange(ids, frontDesk). company-bypass-tick is now a role=checkbox chip.

Test ids for other suites:
- The bar is log-bar; quick buttons are log-bar-<TYPE>.
- Sheet: how-did-it-go (in the Done box: done-box). Form: log-activity-form (in the Done box: done-form).
- Chips and fields: log-type-<TYPE>, outcome-<KEY>, outcome-more, activity-when-toggle, activity-when, activity-time, activity-submit, log-note.
- After a save: log-saved / log-undo; next step follow-up-prompt, next-<choice>, next-day-<first|second|week|pick>, reason-<KEY>, mark-INTERESTED; follow-up-save / follow-up-skip; log-early-yes.
- Book meeting: book-day-*, book-time-HH:MM, book-who, book-opp-yes/new, book-submit.
- Toast: log-toast, log-toast-words, log-toast-undo, log-toast-link.