"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/format";
import { Badge, FormError } from "@/components/ui";
import { IconTrash, IconPlus } from "@/components/icons";
import { addTask, deleteTask, setTaskDone } from "../../../calendar/actions";

export type TaskView = {
  id: string;
  title: string;
  // yyyy-mm-dd
  dueOn: string | null;
  done: boolean;
};

// A checklist on a job: pull the permit, order the lift, call for a final
// inspection. Deliberately thin — a list with an optional day, not a
// project-management tool.
export function TaskList({
  projectId,
  tasks,
  today,
}: {
  projectId: string;
  tasks: TaskView[];
  today: string;
}) {
  const [state, action, pending] = useActionState(addTask, {});
  const form = useRef<HTMLFormElement>(null);
  const [withDate, setWithDate] = useState(false);

  // Clearing the typed row is a DOM job, so it belongs in an effect; the
  // date toggle is state, adjusted during render the way React advises.
  useEffect(() => {
    if (state.success) form.current?.reset();
  }, [state.success]);

  const [handled, setHandled] = useState(state.success);
  if (state.success !== handled) {
    setHandled(state.success);
    if (state.success) setWithDate(false);
  }

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  return (
    <div className="space-y-3 p-5">
      {open.length === 0 && done.length === 0 && (
        <p className="faint text-xs">
          Nothing on the list. The things that are nobody&apos;s job until they are written down go here.
        </p>
      )}

      {open.length > 0 && (
        <ul className="space-y-1.5" data-testid="task-open">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} today={today} />
          ))}
        </ul>
      )}

      <form ref={form} action={action} className="flex flex-wrap items-end gap-2" data-testid="task-form">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="block flex-1 text-xs">
          <span className="faint block">What needs doing</span>
          <input
            name="title"
            required
            maxLength={200}
            placeholder="Pull the electrical permit"
            className="input input-sm w-full"
            data-testid="task-title"
          />
        </label>
        {withDate ? (
          <label className="block text-xs">
            <span className="faint block">Wanted by</span>
            <input name="dueOn" type="date" className="input input-sm" data-testid="task-due" />
          </label>
        ) : (
          <input type="hidden" name="dueOn" value="" />
        )}
        <button type="submit" disabled={pending} className="btn btn-ghost btn-sm" data-testid="task-add">
          <IconPlus size={13} />
          Add
        </button>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={withDate}
            onChange={(fired) => setWithDate(fired.target.checked)}
            data-testid="task-with-date"
          />
          <span className="muted">Give it a day</span>
        </label>
      </form>

      <FormError message={state.error} />

      {done.length > 0 && (
        <details className="text-xs">
          <summary className="faint cursor-pointer">
            {done.length} done
          </summary>
          <ul className="mt-2 space-y-1.5" data-testid="task-done">
            {done.map((task) => (
              <TaskRow key={task.id} task={task} today={today} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TaskRow({ task, today }: { task: TaskView; today: string }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const late = !task.done && task.dueOn !== null && task.dueOn < today;

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
    });

  return (
    <li className="flex flex-wrap items-center justify-between gap-2" data-testid="task-row">
      <label className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          checked={task.done}
          disabled={pending}
          onChange={() => run(() => setTaskDone(task.id, !task.done))}
          aria-label={`${task.title} is done`}
          data-testid="task-check"
        />
        <span className={`text-sm ${task.done ? "line-through opacity-60" : ""}`}>{task.title}</span>
        {task.dueOn && (
          <Badge color={late ? "#f87171" : "#94a3b8"}>
            {late ? "was due " : "by "}
            {formatDay(`${task.dueOn}T12:00:00Z`)}
          </Badge>
        )}
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteTask(task.id))}
          aria-label={`Remove ${task.title}`}
          className="btn btn-ghost btn-sm !px-1.5"
          data-testid="task-delete"
        >
          <IconTrash size={12} />
        </button>
      </div>
      <FormError message={error} />
    </li>
  );
}
