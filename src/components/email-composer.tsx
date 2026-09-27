"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconMail, IconX, IconSearch, IconCheck, IconUserPlus, IconFileText, IconLayers, IconSend } from "@/components/icons";
import { FormError } from "@/components/ui";
import { useSearch } from "@/lib/use-search";
import { EMAIL_FIELDS, MAX_ATTACHMENTS, emailToken } from "@/lib/email-fields";

export type Recipient = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  optedOut: boolean;
};

type Setup = {
  used: number;
  limit: number;
  blocker: string | null;
  templates: { id: string; name: string; subject: string; body: string }[];
  files: { id: string; name: string; fileName: string; sizeBytes: number }[];
};

type Outcome =
  | { ok: false; error: string; used: number; limit: number }
  | {
      ok: true;
      sent: number;
      failed: { name: string; error: string }[];
      skipped: { name: string; reason: string }[];
      used: number;
      limit: number;
    };

function canEmail(recipient: Recipient) {
  return Boolean(recipient.email) && !recipient.optedOut;
}

function humanSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The Email button and the window it opens. The same window everywhere:
// on a contact it starts with that person on the To line, on a marketing
// file or template it starts with that attached. Each person gets their
// own copy, with the {{fields}} filled in for them.
export function EmailButton({
  label = "Email",
  recipients = [],
  fileId,
  templateId,
  className = "btn btn-ghost btn-sm",
  title,
}: {
  label?: string;
  recipients?: Recipient[];
  fileId?: string;
  templateId?: string;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} title={title} aria-label={title}>
        <IconMail size={13} />
        {label}
      </button>
      {open && (
        <EmailComposer
          initialRecipients={recipients}
          initialFileId={fileId}
          initialTemplateId={templateId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EmailComposer({
  initialRecipients,
  initialFileId,
  initialTemplateId,
  onClose,
}: {
  initialRecipients: Recipient[];
  initialFileId?: string;
  initialTemplateId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [fileIds, setFileIds] = useState<string[]>(initialFileId ? [initialFileId] : []);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Extract<Outcome, { ok: true }> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");

  useEffect(() => {
    let cancelled = false;
    fetch("/dashboard/email/setup", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: Setup) => {
        if (cancelled) return;
        setSetup(data);
        const template = initialTemplateId ? data.templates.find((row) => row.id === initialTemplateId) : undefined;
        if (template) {
          setTemplateId(template.id);
          setSubject(template.subject);
          setBody(template.body);
        }
      })
      .catch(() => !cancelled && setLoadError("Couldn't open email. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [initialTemplateId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const { results, loading } = useSearch<Recipient>(
    searching ? `/dashboard/email/recipients?q=${encodeURIComponent(query.trim())}` : null,
  );

  const sendable = recipients.filter(canEmail);
  const left = setup ? Math.max(0, setup.limit - setup.used) : 0;
  const overLimit = sendable.length > left;

  function toggleRecipient(recipient: Recipient) {
    setRecipients((prev) =>
      prev.some((row) => row.id === recipient.id) ? prev.filter((row) => row.id !== recipient.id) : [...prev, recipient],
    );
  }

  function applyTemplate(id: string) {
    const template = setup?.templates.find((row) => row.id === id);
    if (!template) {
      setTemplateId(null);
      return;
    }
    const typed = subject.trim() || body.trim();
    if (typed && !window.confirm(`Replace what you've written with “${template.name}”?`)) return;
    setTemplateId(template.id);
    setSubject(template.subject);
    setBody(template.body);
  }

  // Drops a field chip where the cursor last was, in the subject or body.
  function insertField(key: string) {
    const token = emailToken(key);
    const target = lastFocus.current === "subject" ? subjectRef.current : bodyRef.current;
    const value = lastFocus.current === "subject" ? subject : body;
    const set = lastFocus.current === "subject" ? setSubject : setBody;
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function send() {
    setError(null);
    setSending(true);
    try {
      const response = await fetch("/dashboard/email/send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactIds: sendable.map((row) => row.id),
          subject,
          body,
          templateId,
          fileIds,
        }),
      });
      const result = (await response.json()) as Outcome;
      setSetup((prev) => (prev ? { ...prev, used: result.used, limit: result.limit } : prev));
      if (!result.ok) setError(result.error);
      else {
        setOutcome(result);
        // The Activity counts on the page behind now include these.
        router.refresh();
      }
    } catch {
      setError("The send didn't finish. Check each contact's Activity before sending again, so nobody gets it twice.");
    } finally {
      setSending(false);
    }
  }

  const attached = setup ? setup.files.filter((file) => fileIds.includes(file.id)) : [];

  return (
    <div className="modal-backdrop" onClick={() => !sending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Email"
        onClick={(event) => event.stopPropagation()}
        className="card card-lit popover flex max-h-[92vh] w-full max-w-2xl flex-col"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Email</h2>
            <p className="faint mt-0.5 text-xs">Each person gets their own copy. Replies come to you.</p>
          </div>
          <div className="flex items-center gap-2">
            {setup && (
              <span
                data-testid="email-counter"
                title="Emails you have sent today, of your daily allowance"
                className={`badge num ${left === 0 ? "text-[var(--danger)]" : left <= 5 ? "text-[var(--warn)]" : ""}`}
              >
                {setup.used} of {setup.limit} sent today
              </span>
            )}
            <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="btn btn-ghost btn-sm">
              <IconX size={13} />
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="p-5">
            <FormError message={loadError} />
          </div>
        ) : !setup ? (
          <p className="faint p-6 text-center text-sm">Loading…</p>
        ) : outcome ? (
          <div className="space-y-3 p-5" data-testid="email-outcome">
            <p className="text-sm font-medium">
              {outcome.sent === 0 ? "Nothing was sent." : `Sent to ${outcome.sent} ${outcome.sent === 1 ? "person" : "people"}.`}
            </p>
            {outcome.skipped.length > 0 && (
              <p className="muted text-xs">
                Skipped: {outcome.skipped.map((row) => `${row.name} (${row.reason})`).join(", ")}
              </p>
            )}
            {outcome.failed.length > 0 && (
              <FormError message={`Didn't go through: ${outcome.failed.map((row) => row.name).join(", ")}. Those don't count against today.`} />
            )}
            <p className="faint text-xs">Logged on each contact&apos;s Activity. {Math.max(0, outcome.limit - outcome.used)} left today.</p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {setup.blocker && <FormError message={setup.blocker} />}

              {/* To */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label !mb-0">To</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => { setSearching(true); setAdding(false); }} className="btn btn-ghost btn-sm">
                      <IconSearch size={12} />
                      Search contacts
                    </button>
                    <button type="button" onClick={() => { setAdding(true); setSearching(false); }} className="btn btn-ghost btn-sm">
                      <IconUserPlus size={12} />
                      + Add new contact
                    </button>
                  </div>
                </div>
                <div className="flex min-h-9 flex-wrap gap-1.5 rounded-lg border border-[var(--border)] p-2" data-testid="email-recipients">
                  {recipients.length === 0 && <span className="faint text-xs">Nobody yet. Search your contacts or add a new one.</span>}
                  {recipients.map((recipient) => (
                    <span
                      key={recipient.id}
                      className={`badge gap-1 ${canEmail(recipient) ? "" : "line-through opacity-60"}`}
                      title={
                        !recipient.email ? "No email address on file" : recipient.optedOut ? "Unsubscribed" : recipient.email
                      }
                    >
                      {recipient.name}
                      {!recipient.email ? " · no email" : recipient.optedOut ? " · unsubscribed" : ""}
                      <button
                        type="button"
                        onClick={() => toggleRecipient(recipient)}
                        aria-label={`Remove ${recipient.name}`}
                        className="opacity-70 hover:opacity-100"
                      >
                        <IconX size={10} />
                      </button>
                    </span>
                  ))}
                </div>

                {searching && (
                  <div className="mt-2 rounded-lg border border-[var(--border)]">
                    <div className="border-b border-[var(--border)] p-2">
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search by name, company or email…"
                        aria-label="Search contacts to email"
                        autoFocus
                        className="input input-sm"
                      />
                    </div>
                    <ul className="max-h-48 overflow-y-auto py-1">
                      {results.map((row) => {
                        const on = recipients.some((picked) => picked.id === row.id);
                        return (
                          <li key={row.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-[rgb(255_255_255/0.04)]">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleRecipient(row)}
                                className="h-4 w-4 accent-[var(--brand)]"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {row.name}
                                {row.company && <span className="faint"> · {row.company}</span>}
                              </span>
                              <span className="faint truncate text-xs">
                                {!row.email ? "no email" : row.optedOut ? "unsubscribed" : row.email}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                      {!loading && results.length === 0 && (
                        <li className="faint px-3 py-4 text-center text-xs">
                          {query.trim() ? "No contacts match." : "Type a name, company or email."}
                        </li>
                      )}
                    </ul>
                    <div className="flex justify-end border-t border-[var(--border)] p-2">
                      <button type="button" onClick={() => setSearching(false)} className="btn btn-primary btn-sm">
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {adding && (
                  <QuickContact
                    onAdded={(recipient) => {
                      setRecipients((prev) => (prev.some((row) => row.id === recipient.id) ? prev : [...prev, recipient]));
                      setAdding(false);
                    }}
                    onCancel={() => setAdding(false)}
                  />
                )}
              </div>

              {/* Template */}
              <div>
                <label className="label" htmlFor="email-template">
                  Add Marketing Template
                </label>
                <select
                  id="email-template"
                  className="select"
                  value={templateId ?? ""}
                  onChange={(event) => applyTemplate(event.target.value)}
                >
                  <option value="">{setup.templates.length ? "— Write your own —" : "No templates yet"}</option>
                  {setup.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="email-subject">
                  Subject
                </label>
                <input
                  id="email-subject"
                  ref={subjectRef}
                  className="input"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  onFocus={() => (lastFocus.current = "subject")}
                  maxLength={200}
                />
              </div>

              <div>
                <label className="label" htmlFor="email-body">
                  Message
                </label>
                <textarea
                  id="email-body"
                  ref={bodyRef}
                  className="input min-h-[10rem]"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  onFocus={() => (lastFocus.current = "body")}
                  placeholder={"Hi {{first_name}},\n\n…"}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {EMAIL_FIELDS.map((field) => (
                    <button
                      key={field.key}
                      type="button"
                      className="merge-chip"
                      title={field.description}
                      onClick={() => insertField(field.key)}
                    >
                      {field.label}
                    </button>
                  ))}
                </div>
                <p className="faint mt-1.5 text-xs">
                  Click a chip to drop it in where your cursor is; it fills in for each person. Your business name, address and an unsubscribe link go at the bottom automatically.
                </p>
              </div>

              {/* Files */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label !mb-0">Files</span>
                  <button type="button" onClick={() => setShowFiles((value) => !value)} className="btn btn-ghost btn-sm" aria-expanded={showFiles}>
                    <IconLayers size={12} />
                    Add Marketing File
                  </button>
                </div>
                {attached.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" data-testid="email-attachments">
                    {attached.map((file) => (
                      <span key={file.id} className="badge gap-1">
                        <IconFileText size={11} />
                        {file.name}
                        <button
                          type="button"
                          onClick={() => setFileIds((prev) => prev.filter((id) => id !== file.id))}
                          aria-label={`Remove ${file.name}`}
                          className="opacity-70 hover:opacity-100"
                        >
                          <IconX size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {showFiles && (
                  <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] py-1">
                    {setup.files.length === 0 && (
                      <li className="faint px-3 py-3 text-center text-xs">
                        No marketing files yet. Upload them under Settings → Company Information → Marketing.
                      </li>
                    )}
                    {setup.files.map((file) => {
                      const on = fileIds.includes(file.id);
                      const full = !on && fileIds.length >= MAX_ATTACHMENTS;
                      return (
                        <li key={file.id}>
                          <label className={`flex items-center gap-3 px-3 py-1.5 text-sm ${full ? "opacity-50" : "cursor-pointer hover:bg-[rgb(255_255_255/0.04)]"}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={full}
                              onChange={() =>
                                setFileIds((prev) => (on ? prev.filter((id) => id !== file.id) : [...prev, file.id]))
                              }
                              className="h-4 w-4 accent-[var(--brand)]"
                            />
                            <span className="min-w-0 flex-1 truncate">{file.name}</span>
                            <span className="faint text-xs">{humanSize(file.sizeBytes)}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <FormError message={error ?? undefined} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
              <span className={`text-xs ${overLimit ? "text-[var(--danger)]" : "faint"}`} data-testid="email-summary">
                {sending
                  ? `Sending ${sendable.length}… keep this open.`
                  : overLimit
                    ? `${sendable.length} picked, but only ${left} left today.`
                    : `Sends ${sendable.length} ${sendable.length === 1 ? "email" : "emails"} · ${left - sendable.length} left today after this`}
              </span>
              <button
                type="button"
                onClick={send}
                disabled={sending || Boolean(setup.blocker) || sendable.length === 0 || overLimit || !subject.trim() || !body.trim()}
                className="btn btn-primary btn-sm"
              >
                <IconSend size={13} />
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuickContact({ onAdded, onCancel }: { onAdded: (recipient: Recipient) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/dashboard/email/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = (await response.json()) as { contact?: Recipient; error?: string };
      if (!response.ok || !data.contact) setError(data.error ?? "Couldn't add that contact.");
      else onAdded(data.contact);
    } catch {
      setError("Couldn't add that contact. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  // Not a <form>: this sits inside the window, and Enter must not send.
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-3">
      <p className="text-xs font-medium">New contact</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input input-sm" placeholder="Name" aria-label="New contact name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        <input
          className="input input-sm"
          type="email"
          placeholder="Email"
          aria-label="New contact email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
      </div>
      <FormError message={error ?? undefined} />
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={saving || !name.trim() || !email.trim()} className="btn btn-primary btn-sm">
          <IconCheck size={12} />
          {saving ? "Adding…" : "Add to email"}
        </button>
      </div>
    </div>
  );
}
