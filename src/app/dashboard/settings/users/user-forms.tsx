"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconUserPlus, IconSend, IconX } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { addUser, changeUserRole, removeUser, resendInvite, restoreUser } from "./actions";

// "+ Add user": a name, an email and a role. The person gets an email
// with a link to set their own password; nobody types one for them.
export function AddUserForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addUser, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Compared as an object, not as the message: two invitations in a row
  // report the same words (see CLAUDE.md, Sept 14 audit).
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  if (!open) {
    return (
      <div className="space-y-2 px-5 py-4">
        <FormSuccess message={state.success} />
        <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
          <IconUserPlus size={13} />
          Add user
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3 px-5 py-4" data-testid="add-user-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="add-user-name">Name</label>
          <input id="add-user-name" name="name" className="input" required maxLength={120} defaultValue={state.kept?.name} />
        </div>
        <div>
          <label className="label" htmlFor="add-user-email">Email</label>
          <input id="add-user-email" name="email" type="email" className="input" required maxLength={200} defaultValue={state.kept?.email} />
        </div>
        <div>
          <label className="label" htmlFor="add-user-title">Title <span className="faint">(optional)</span></label>
          <input id="add-user-title" name="title" className="input" maxLength={120} defaultValue={state.kept?.title} placeholder="Estimator" />
        </div>
        <div>
          <label className="label" htmlFor="add-user-role">Role</label>
          <select id="add-user-role" name="role" className="select" defaultValue={state.kept?.role ?? "MEMBER"}>
            <option value="MEMBER">Member — everyday work, sends email</option>
            <option value="ADMIN">Admin — also users, settings and company files</option>
          </select>
        </div>
      </div>
      <FormError message={state.error} />
      <FormSuccess message={state.success} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Close
        </button>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          <IconSend size={13} />
          {pending ? "Sending invitation…" : "Add and send invitation"}
        </button>
      </div>
    </form>
  );
}

// The controls at the end of a user's row. Nothing here for the owner or
// for yourself; the server refuses both anyway.
export function UserRowActions({
  userId,
  name,
  role,
  removed,
  invited,
}: {
  userId: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  removed: boolean;
  invited: boolean;
}) {
  // One answer per row, whichever control gave it, so the row always shows
  // the result of the last thing pressed.
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    switch (formData.get("op")) {
      case "role":
        return changeUserRole(prev, formData);
      case "invite":
        return resendInvite(prev, formData);
      case "remove":
        return removeUser(prev, formData);
      case "restore":
        return restoreUser(prev, formData);
      default:
        return prev;
    }
  }, {});
  const [confirming, setConfirming] = useState(false);
  const message = state.error || state.success ? state : null;

  if (removed) {
    return (
      <div className="flex flex-col items-end gap-1">
        <form action={formAction}>
          <input type="hidden" name="op" value="restore" />
          <input type="hidden" name="userId" value={userId} />
          <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
            Restore
          </button>
        </form>
        {message && <RowMessage state={message} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <form action={formAction}>
          <input type="hidden" name="op" value="role" />
          <input type="hidden" name="userId" value={userId} />
          <select
            name="role"
            defaultValue={role}
            aria-label={`Role for ${name}`}
            className="select input-sm !w-auto"
            disabled={pending}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
        </form>
        {invited && (
          <form action={formAction}>
            <input type="hidden" name="op" value="invite" />
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
              {pending ? "Working…" : "Resend invite"}
            </button>
          </form>
        )}
        {confirming ? (
          <form action={formAction} onSubmit={() => setConfirming(false)} className="flex items-center gap-1">
            <input type="hidden" name="op" value="remove" />
            <input type="hidden" name="userId" value={userId} />
            <span className="text-xs">Remove {name}?</span>
            <button type="submit" disabled={pending} className="btn btn-danger btn-sm">
              Remove
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm" aria-label="Cancel">
              <IconX size={12} />
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="btn btn-ghost btn-sm" aria-label={`Remove ${name}`}>
            Remove
          </button>
        )}
      </div>
      {message && <RowMessage state={message} />}
    </div>
  );
}

function RowMessage({ state }: { state: ActionState }) {
  return state.error ? (
    <span role="alert" className="text-xs text-[var(--danger)]">{state.error}</span>
  ) : (
    <span role="status" className="text-xs text-[var(--ok)]">{state.success}</span>
  );
}
