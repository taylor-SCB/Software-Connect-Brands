import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDay } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { crewOverlaps, eventDayCount, byDayThenTime, dayRangeTitle } from "@/lib/calendar";
import { EVENT_SELECT, toEventView, loadEventChoices } from "@/lib/calendar-data";
import { PageHeader, Card, CardHeader, StatTile, StatusBadge, EmptyState } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconCalendar } from "@/components/icons";
import { ProjectTabs } from "../project-tabs";
import { EventList } from "../../../calendar/calendar-views";
import { ScheduleInstallForm } from "./schedule-install-form";
import { TaskList, type TaskView } from "./task-list";

// When this job happens: the install days booked per scope of work, the
// meetings and walks around them, and the list of things to do.
export default async function ProjectSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);

  const [project, choices] = await Promise.all([
    prisma.project.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        number: true,
        name: true,
        stage: true,
        customerName: true,
        siteAddress: true,
        startOn: true,
        scopes: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            isDefault: true,
            crew: { select: { id: true, name: true } },
          },
        },
        events: { orderBy: [{ startOn: "asc" }, { startTime: "asc" }], select: EVENT_SELECT },
        tasks: {
          orderBy: [{ doneAt: "asc" }, { dueOn: "asc" }, { position: "asc" }],
          select: { id: true, title: true, dueOn: true, doneAt: true },
        },
      },
    }),
    loadEventChoices(organizationId),
  ]);
  if (!project) notFound();

  const events = project.events.map(toEventView);
  // Day order first: a 7am install next month must not sort above a 9am
  // walk-through tomorrow.
  const upcoming = events.filter((event) => (event.endOn ?? event.startOn) >= today).sort(byDayThenTime);
  const past = events.filter((event) => (event.endOn ?? event.startOn) < today).sort(byDayThenTime);

  const installDays = events
    .filter((event) => event.type === "Install")
    .reduce((sum, event) => sum + eventDayCount(event), 0);

  const tasks: TaskView[] = project.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    dueOn: task.dueOn ? task.dueOn.toISOString().slice(0, 10) : null,
    done: task.doneAt !== null,
  }));
  const openTasks = tasks.filter((task) => !task.done).length;
  const lateTasks = tasks.filter((task) => !task.done && task.dueOn !== null && task.dueOn < today).length;

  const clashes = crewOverlaps(
    events.map((event) => ({
      crewId: event.crewId,
      crew: event.crewName ? { name: event.crewName } : null,
      startOn: event.startOn,
      endOn: event.endOn,
      startTime: event.startTime,
      endTime: event.endTime,
    })),
  );

  // Which scopes have nothing booked yet — the thing this page is really
  // for, on a job split into a roofing half and a locks half.
  const shownScopes = project.scopes.filter(
    (scope) => !scope.isDefault || project.scopes.length === 1,
  );
  const scheduled = new Set(
    events.filter((event) => event.type === "Install").map((event) => event.scopeId ?? "__job__"),
  );

  const firstDay = upcoming[0] ?? null;

  return (
    <div>
      <BackLink href={`/dashboard/projects/${project.id}`} label={project.name} />

      <PageHeader
        eyebrow={`Job · PRJ-${project.number}`}
        title="Schedule"
        subtitle={`${project.name} · ${project.customerName}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project.stage} />
            <Link href="/dashboard/calendar" className="btn btn-ghost btn-sm">
              <IconCalendar size={13} />
              Whole calendar
            </Link>
          </div>
        }
      />

      <ProjectTabs projectId={project.id} current="schedule" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Starts"
          value={project.startOn ? formatDay(project.startOn) : "Not booked"}
          hint={project.startOn ? "First day on site" : "Book an install below"}
          accent={project.startOn ? "#34d399" : "#94a3b8"}
        />
        <StatTile
          label="Install days booked"
          value={installDays}
          hint={installDays === 0 ? "Nothing on site yet" : "Across every scope"}
        />
        <StatTile
          label="Next up"
          value={firstDay ? formatDay(`${firstDay.startOn}T12:00:00Z`) : "—"}
          hint={firstDay ? firstDay.title : "Nothing coming"}
          accent="#60a5fa"
        />
        <StatTile
          label="To do"
          value={openTasks}
          hint={lateTasks > 0 ? `${lateTasks} past its day` : "On the list"}
          accent={lateTasks > 0 ? "#f87171" : "#a78bfa"}
        />
      </div>

      {clashes.length > 0 && (
        <Card lit className="mb-5">
          <div className="space-y-1 p-4" data-testid="overlap-note">
            {clashes.map((note) => (
              <p key={`${note.crewId}-${note.day}`} className="text-sm text-[var(--warn)]">
                {note.crewName} is in {note.count} places on {formatDay(`${note.day}T12:00:00Z`)}. Worth a
                look.
              </p>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-5">
        <Card lit>
          <CardHeader
            title="Install days"
            subtitle="Each scope of work gets its own days, on the crew already assigned to it."
          />
          <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
            {shownScopes.map((scope) => {
              const key = scope.isDefault ? "__job__" : scope.id;
              const booked = scheduled.has(key) || (scope.isDefault && scheduled.has(scope.id));
              const days = events
                .filter((event) => event.type === "Install" && (event.scopeId ?? "__job__") === key)
                .reduce((sum, event) => sum + eventDayCount(event), 0);
              return (
                <li
                  key={scope.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  data-testid="scope-schedule"
                  data-scope-id={scope.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{scope.isDefault ? project.name : scope.name}</p>
                    <p className="faint num text-xs">
                      {booked
                        ? `${days} ${days === 1 ? "day" : "days"} booked`
                        : "Not scheduled yet"}
                      {scope.crew ? ` · ${scope.crew.name}` : " · nobody assigned"}
                    </p>
                  </div>
                  <ScheduleInstallForm
                    projectId={project.id}
                    scopeId={scope.isDefault ? null : scope.id}
                    scopeName={scope.isDefault ? project.name : scope.name}
                    crewName={scope.crew?.name ?? null}
                    today={today}
                  />
                </li>
              );
            })}
          </ul>
        </Card>

        <Card lit>
          <CardHeader
            title="Coming up"
            subtitle={
              project.siteAddress
                ? `Every day on this job. ${project.siteAddress} unless a day says otherwise.`
                : "Every day on this job, install or otherwise."
            }
          />
          <div className="p-5">
            <EventList
              events={upcoming}
              choices={choices}
              hideJob
              empty="Book an install above, or add a site walk or meeting from the calendar."
            />
          </div>
        </Card>

        <Card lit>
          <CardHeader title="Things to do" subtitle="The list that keeps a job from stalling on a permit." />
          <TaskList projectId={project.id} tasks={tasks} today={today} />
        </Card>

        {past.length > 0 && (
          <Card>
            <CardHeader
              title="Already been"
              subtitle={`${past.length} ${past.length === 1 ? "day" : "days"} behind us · ${dayRangeTitle(
                past[0].startOn,
                past[past.length - 1].endOn ?? past[past.length - 1].startOn,
              )}`}
            />
            <div className="p-5">
              {past.length === 0 ? (
                <EmptyState icon={<IconCalendar size={20} />} title="Nothing yet" body="" />
              ) : (
                <EventList events={past} choices={choices} hideJob empty="" />
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
