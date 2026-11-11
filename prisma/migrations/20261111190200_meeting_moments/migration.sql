-- A booked meeting's moment, repaired once from its calendar entry (final
-- audit fix review, Nov 11, 2026). Before the Nov 11 audit the calendar form
-- wrote OpportunityMeeting."on" as the entry's bare day, midnight UTC, which
-- is the evening before in the US. waitingMeetings now reads the entry's own
-- day and time, but the Pipeline tiles (meetingFocus) and health's
-- meetingDue / lastmeet read "on", so for those rows a tile said "Met — how
-- did it go?" from the evening before while the contact page said the
-- meeting was still ahead. Every writer since keeps "on" at the entry's
-- moment (the calendar form, moveEvent, a reschedule), so repairing the old
-- rows once makes every reader agree.
--
-- Only meetings nobody has answered (no Held / No-show on the row or on the
-- history line it was logged as): an answered one's "on" is when it
-- happened. Only where it differs, so a re-run changes nothing. The moment is
-- the entry's day at its time (noon when it has none, as zonedMoment reads
-- it) in the workspace's zone, stored as UTC like every Prisma timestamp. A
-- workspace whose zone Postgres doesn't know, or an entry whose time isn't
-- HH:MM, is left alone rather than failing the deploy.
UPDATE "OpportunityMeeting" om
   SET "on" = fix.at
  FROM (
    SELECT m.id,
           ((e."startOn"::date
             + (CASE WHEN e."startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN e."startTime" ELSE '12:00' END)::time)
             AT TIME ZONE org."timeZone") AT TIME ZONE 'UTC' AS at
      FROM "OpportunityMeeting" m
      JOIN "CalendarEvent" e ON e.id = m."eventId"
      JOIN "Opportunity" o ON o.id = m."opportunityId"
      JOIN "Organization" org ON org.id = o."organizationId" AND org.id = e."organizationId"
      LEFT JOIN "Activity" a ON a.id = m."activityId"
     WHERE (m.outcome IS NULL OR m.outcome NOT IN ('HELD', 'NO_SHOW'))
       AND (a.id IS NULL OR a.outcome IS NULL OR a.outcome NOT IN ('HELD', 'NO_SHOW'))
       AND (e."startTime" IS NULL OR e."startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
       AND org."timeZone" IN (SELECT name FROM pg_timezone_names)
  ) fix
 WHERE om.id = fix.id
   AND om."on" IS DISTINCT FROM fix.at;
