"use client";

import { useActionState, useState } from "react";
import { Field, FormError, FormSuccess } from "@/components/ui";
import { ImageUploadField } from "@/components/image-upload-field";
import { updateAccount, changePassword } from "../actions";
import type { ActionState } from "@/lib/forms";

export function AccountForm({
  user,
}: {
  user: {
    name: string;
    email: string;
    title: string | null;
    phone: string | null;
    avatarUrl: string | null;
    receiveInAppMessages: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateAccount, {});
  const [inApp, setInApp] = useState(user.receiveInAppMessages);

  return (
    <form action={formAction} className="space-y-5 p-5">
      <ImageUploadField
        label="Your picture"
        name="avatar"
        currentUrl={user.avatarUrl}
        fallback={user.name.charAt(0).toUpperCase()}
        shape="round"
        hint="Shown in the sidebar and on the Company Users list."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" name="name" defaultValue={user.name} required />
        <Field label="Job title" name="title" placeholder="Owner" defaultValue={user.title ?? ""} />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={user.email}
          required
          hint="This is what you log in with."
        />
        <Field label="Mobile phone" name="phone" type="tel" defaultValue={user.phone ?? ""} />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-sm font-medium">Receive in-app messages</p>
          <p className="faint text-xs">Saved now; messaging itself is coming.</p>
        </div>
        <input type="hidden" name="receiveInAppMessages" value={inApp ? "true" : "false"} />
        <button
          type="button"
          role="switch"
          aria-checked={inApp}
          aria-label="Receive in-app messages"
          className="switch"
          onClick={() => setInApp((value) => !value)}
        />
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changePassword, {});

  return (
    <form action={formAction} className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password" name="currentPassword" type="password" required />
        <Field label="New password" name="newPassword" type="password" required hint="At least 8 characters." />
        <Field label="Confirm new password" name="confirmPassword" type="password" required />
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-ghost">
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
