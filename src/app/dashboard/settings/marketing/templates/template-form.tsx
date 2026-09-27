"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { FormError } from "@/components/ui";
import { EMAIL_FIELDS, emailToken } from "@/lib/email-fields";
import type { ActionState } from "@/lib/forms";

// A marketing template: a name for the list, then the email itself. The
// chips drop a {{field}} in where the cursor is, in the subject or the
// body, the same way the contract templates work.
export function MarketingTemplateForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: { id: string; name: string; subject: string; body: string };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [subject, setSubject] = useState(state.kept?.subject ?? defaults?.subject ?? "");
  const [body, setBody] = useState(state.kept?.body ?? defaults?.body ?? "");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");

  function insertField(key: string) {
    const token = emailToken(key);
    const inSubject = lastFocus.current === "subject";
    const target = inSubject ? subjectRef.current : bodyRef.current;
    const value = inSubject ? subject : body;
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? value.length;
    (inSubject ? setSubject : setBody)(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <form action={formAction} className="space-y-4">
      {defaults && <input type="hidden" name="id" value={defaults.id} />}
      <div>
        <label className="label" htmlFor="tpl-name">
          Template name
        </label>
        <input
          id="tpl-name"
          name="name"
          className="input"
          required
          maxLength={120}
          defaultValue={state.kept?.name ?? defaults?.name ?? ""}
          placeholder="Spring promotion"
        />
      </div>
      <div>
        <label className="label" htmlFor="tpl-subject">
          Subject
        </label>
        <input
          id="tpl-subject"
          name="subject"
          ref={subjectRef}
          className="input"
          required
          maxLength={200}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onFocus={() => (lastFocus.current = "subject")}
        />
      </div>
      <div>
        <label className="label" htmlFor="tpl-body">
          Message
        </label>
        <textarea
          id="tpl-body"
          name="body"
          ref={bodyRef}
          className="input min-h-[14rem]"
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onFocus={() => (lastFocus.current = "body")}
          placeholder={"Hi {{first_name}},\n\n…\n\n{{sender_name}}\n{{business_name}}"}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EMAIL_FIELDS.map((field) => (
            <button key={field.key} type="button" className="merge-chip" title={field.description} onClick={() => insertField(field.key)}>
              {field.label}
            </button>
          ))}
        </div>
        <p className="faint mt-1.5 text-xs">
          Each chip fills in for the person it goes to. Your business name, address and an unsubscribe link are added at the bottom automatically.
        </p>
      </div>
      <FormError message={state.error} />
      <div className="flex justify-end gap-2">
        <Link href="/dashboard/settings/marketing" className="btn btn-ghost btn-sm">
          Cancel
        </Link>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
