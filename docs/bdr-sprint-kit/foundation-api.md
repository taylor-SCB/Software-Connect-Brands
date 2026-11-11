COMBINED FOUNDATION API (claude/bdr-sprint @ f8ebd40). Every server action is scoped to the workspace (requireSession) and validated with zod. Every loader takes organizationId and is batched: never call one per row.

=== READ SIDE: HEALTH (look) ===
import { leadHealth, rollUpCompany, pulseCaption, reasonWords, METER_STEPS, TALK_STATUSES, warmth, zoneDay, zoneTime, shortDay, aheadDay, pastDay, time12, wholeDollars, nextKindOf, type LeadHealth, type CompanyHealth, type HealthInput, type HealthContext, type MeterState, type MeterStep, type HealthTone, type HealthState } from "@/lib/health"   (pure and browser-safe; health is computed, never stored)

LeadHealth (plain JSON, safe to pass to client components):
{ state 'NEW'|'TRYING'|'REACHED'|'WON'|'CLOSED'; tone 'good'|'warn'|'risk'|'none'; word 'New'|'Trying'|'Warm'|'Cooling'|'Cold'|'Won'|'Closed'; mark; score number|null (REACHED only); band; parts {recent,talk,next,drag}|null; breakdown 'Recent 25 · Talk 30 · Next step 0 = 55'|null; reason (one sentence); reasonKey 'owes'|'late'|'meeting'|'paperwork'|'quiet'|'tries'|'talked'|'park'|'stalled'|'trying'|'new'|'won'|'closed'; stalled; park (true = show 'Try again in 30 days'; false once a try is booked); caption '7 tries · 2 talks · 1 meeting · last touch 2d'; miniCaption '4 tries · 1 talk · 6d'; counts {tries,talks,meetings,byType{calls,texts,emails,meetings},lastTouchDays,lastTouchBy{id,name}}; nextText; owes {cents,daysLate,text}|null; collected; meter {step -1..6, interested, won, closed {at,label,reason (words, e.g. 'Has a vendor')}|null, steps[7] {name,state 'done'|'current'|'next'|'todo'|'closed',date,by (a name, 'auto' or null),readOnly,hint}, current, nextStep, action {key,label}|null}; label (the aria text) }
CompanyHealth = LeadHealth & { reached, people, reachedText '2 of 7 reached', warmestId }.
reasonWords(key) turns 'HAS_VENDOR' into 'Has a vendor'; any other text passes through unchanged.

Loaders (server only, from "@/lib/health-load"):
- loadContactHealth(orgId, ids, { settings?, now? }) → Map<id, LeadHealth>. 2 statements.
- loadCompanyHealth(orgId, ids, opts) → Map<id, CompanyHealth>. 3 statements.
- loadOpportunityHealth(orgId, ids, opts) → Map<id, LeadHealth>. 2 statements.
- contactHealth / companyHealth / opportunityHealth(orgId, id) load one record.
- healthSettings(orgId) → {timeZone, quietDays, parkAfterTries}. Fetch it once per page and pass it as settings.
- pulseCaption(health, repId) → '6d · Priya'.

Components:
- <LifecycleMeter health size="header"|"mini" showReason? showCaption? interactive? onNext? nextHref? className? testId?> ("use client"; testids lifecycle-meter, -bars, -reason, -caption, -phone, -closed, -popover, -step-popover). It stops click propagation, so it is safe inside clickable tiles. Pass interactive={false} inside a link.
- <HealthRing health|tone hollow>{<Avatar round/>}</HealthRing>, <HealthDot health|tone hollow label?/>, <HealthWordStatic/> (server-safe, from "@/components/health-marks").
- <HealthWord health interactive?/> (chip with a breakdown popover; testids health-word, health-popover).
- <DealJourney journey={dealJourney({meetingAt,quoteSentAt,contractSentAt,signedAt,depositPaidAt,quoteDraft?,quoteAccepted?,contractDraft?}, timeZone)} next={<button className="btn btn-primary">…</button>} details tone? stickyNext?/> (from "@/components/deal-journey" and "@/lib/health-journey"; next keys: start-quote, send-quote, quote-yes, make-contract, send-signature, signing-link, deposit).
- StatusBadge and DealStageBadge are used as before. They now sit on one brand ramp (data-ramp 0-8), closed states are grey, only OVERDUE is red, and labels come from CONTACT_STATUS_LABELS (so they read 'Attempted' and 'Connected'). statusRamp(status) and statusLabel(status) are exported from ui.tsx.
- CSS: data-health="good|warn|risk|none" sets --hc/--hs; the fixed --health-good/-warn/-risk/-none tokens and their -soft fills are the same in both looks; classes .health-dot, .health-ring, .health-word, .lm-*, .dj-*, .docnum (mono for QUO-/CON-/INV-/PRJ-); type sizes text-caption/body/lead/heading/display (12/14/16/20/28). .num is now sans with tabular digits.

=== WRITE SIDE: OUTCOMES, LADDER, ACTIONS (data) ===
Constants (src/lib/constants.ts):
- ACTIVITY_OUTCOMES = NO_ANSWER|VOICEMAIL|GATEKEEPER|BAD_NUMBER|TALKED|REPLIED|SENT|HELD|NO_SHOW. ACTIVITY_OUTCOME_LABELS read No answer, Left voicemail, Front desk, Wrong number, Talked, They replied, Sent, Held, No-show.
- OUTCOMES_BY_TYPE: PHONE_CALL [NO_ANSWER,VOICEMAIL,GATEKEEPER,BAD_NUMBER,TALKED]; TEXT/EMAIL [SENT,REPLIED]; MEETING [HELD,NO_SHOW].
- CONNECT_OUTCOMES [TALKED,REPLIED,HELD]. isConnect({type,outcome,occurredAt}) is the same rule as the triggers and as health.
- STATUS_REASONS PRICE|TIMING|HAS_VENDOR|NO_BUDGET|OTHER, with STATUS_REASON_LABELS.
- NEXT_STEP_KINDS follow|book|park|meeting. PARK_DAYS 30.
- CONTACT_STATUS_LABELS: CONTACTED 'Attempted', CONNECTED 'Connected'. statusRank: CONTACTED 1, CONNECTED 2, INTERESTED/NOT_INTERESTED 3, MEETING_SET 4 … WON 8. START_STATUSES includes CONNECTED.

src/lib/outcomes.ts (browser-safe): outcomeSchema, reasonSchema, markSchema (INTERESTED|NOT_INTERESTED), nextStepSchema {kind, on?, time?, type?, withContactIds?, where?, note?, opportunity?: 'auto'|'new'|<open oppId>}, readNextStep(formData), outcomeProblem(type,outcome), outcomeNote({outcome,mark,reason,booked}), connectOutcomeFor(type).

contacts/actions.ts:
- logActivity(prev, formData) → {success, error?, kept?, followUp?, batchId, notices?, opportunityId?}. Used by both the contact log and the company log.
  - Existing fields: contactId|companyId, extraContactIds, type, body (may be empty when an outcome or mark is given), occurredOn, atTime, bypass.
  - New optional fields: outcome; mark plus reason; next, nextOn, nextTime, nextType, nextWith (repeatable), nextWhere, nextNote, opportunity.
  - TALKED/REPLIED/HELD make the people Connected. MEETING+HELD sets Meeting Completed on the contact and the tile. NO_SHOW is not a touch.
  - next=meeting books through markMeetingSet/attachMeeting with bookedById.
  - GATEKEEPER lets a company-page log through with nobody ticked.
  - An outcome or mark dated ahead is refused.
  - followUp comes back only when no next step was given.
- scheduleFollowUps(seed, items, batchId?). A Meeting tick now writes a 'Try to book a meeting · Name' Call reminder and moves no status (decision 5).
- bookMeeting({contactId, on, time?, withContactIds?, where?, note?, opportunity?}) → {success, batchId, opportunityId, eventId}|{error}.
- bookingOptions(contactId) → {people[], opportunities[] {id,title,primaryName,ownerName,includesThem}}.
- undoLog(batchId) → {success:'Undone'}|{error}. Reverses one whole save in one transaction, including Pipeline batches ('m:<meetingId>:…'). Only whoever logged it, or an Owner or Admin, can undo.

calendar/actions.ts:
- completeEventWithLog(eventId, {activityType, note, outcome?, mark?, reason?, next?, early?}) → {success, batchId, notices}|{error, confirmEarly?}.
  - A meeting ticked done that has happened = HELD, which sets Meeting Completed with no double count.
  - HELD on a meeting still ahead returns confirmEarly; call again with early:true.
  - NO_SHOW keeps Meeting Set.

deals/opportunity-actions.ts (meeting ids come from loadOpportunity().meetings[].id):
- markMeetingHeld(meetingId, {early?, note?}) → {success:'Held · Meeting Completed', batchId, opportunityId}|{error, confirmEarly}.
- markMeetingNoShow(meetingId) → {success, batchId}|{error}.
- rescheduleMeeting(meetingId, {on, time?}) → {success, meetingId, batchId?}. A missed meeting is marked NO_SHOW and a new one is booked; the new meetingId comes back.
- saveLostReason(opportunityId, reason) → {success:'Reason saved'}|{error:'Move it to Lost first'}.
- These four are not registered as server actions until a screen imports them.

Other actions:
- status-actions.ts setRecordStatus({kind,id,target,dates?,reason?}). Moving from Not Actioned or Attempted to Interested, Not Interested or Meeting Set writes Connected first, the same day.
- deals/ai-actions.ts logFollowUpSent → {success, batchId}, and writes outcome SENT.

Server libs (take organizationId):
- markConnected and markByHand (status.ts).
- attachMeeting(who, ids, {on, activityId?, eventId?, opportunity?}).
- src/lib/meetings.ts: recordMeetingHeld, recordMeetingNoShow, bookMeetingCore, rescheduleMeetingCore, meetingFor.
- src/lib/undo-log.ts: newBatchId() (use it for any new save that should be undoable), meetingBatchId, undoLogCore.

Data for readers:
- Contact/Company.lastConnectAt and lastTouchAt are kept by the triggers. Call crm_touch_due(org) before filtering on either.
- Activity.outcome null means 'not recorded'.
- OpportunityMeeting has bookedById (credit for a held meeting) and outcome (HELD|NO_SHOW).
- StatusChange.reason holds a key; show it with reasonWords() or STATUS_REASON_LABELS.
- StatusChange.batchId and CalendarEvent.batchId link rows to their save.
- Organization.outcomesSince is 'Talks counted from'. weekly*Goal and parkAfterTries are also on Organization.

=== WIRING THE METER'S action.key TO ACTIONS ===
- call: logActivity with an outcome chip. With no answer or voicemail, next=follow.
- book: the Book meeting sheet. Get choices from bookingOptions, save with bookMeeting, or logActivity next=meeting.
- meeting: show only; nothing to call.
- mark-held: markMeetingHeld(meetingId) when there is an OpportunityMeeting; otherwise completeEventWithLog on the calendar entry with outcome HELD. Handle confirmEarly by asking, then call again with early:true. Offer No-show next to it through markMeetingNoShow.
- start-quote / quote-yes / signing-link / deposit: the existing quote, contract and invoice flows. For decision 19, Build Quote stays at Meeting Completed.
- park: logActivity next=park.
- Not interested or Lost: pass reason through logActivity mark=NOT_INTERESTED, setRecordStatus reason, or saveLostReason.
- Every save hands back batchId. Show 'Saved · Undo' and call undoLog(batchId).