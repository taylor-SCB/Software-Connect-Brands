"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FormError, FormSuccess } from "@/components/ui";
import { IconChevronDown, IconChevronRight, IconUserPlus, IconX } from "@/components/icons";
import { useSearch } from "@/lib/use-search";
import type { JobAccount } from "@/lib/job-photos";
import { grantPhotoAccess } from "../../photo-actions";

type Picked = { key: string; label: string; person: { contactId: string } | { name?: string; email: string } };
type Found = { id: string; name: string; company: string | null; email: string | null };

// Grant Access on one folder of a job's photos: the companies on the job
// with a button that ticks everyone under each (or open it and tick people
// one by one), plus Invite Other Users from the CRM or by email. View only
// or Editor, and each person is emailed their own link.
export function GrantAccessButton({
  projectId,
  folderId,
  folderName,
  accounts,
  emailOn,
}: {
  projectId: string;
  folderId: string | null;
  folderName: string;
  accounts: JobAccount[];
  emailOn: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm" data-testid="grant-open">
        <IconUserPlus size={13} />
        Grant access
      </button>
      {open && (
        <GrantDialog
          projectId={projectId}
          folderId={folderId}
          folderName={folderName}
          accounts={accounts}
          emailOn={emailOn}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function GrantDialog({
  projectId,
  folderId,
  folderName,
  accounts,
  emailOn,
  onClose,
}: {
  projectId: string;
  folderId: string | null;
  folderName: string;
  accounts: JobAccount[];
  emailOn: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [role, setRole] = useState<"VIEW" | "EDIT">("VIEW");
  const [sendEmail, setSendEmail] = useState(true);
  const [inviting, setInviting] = useState<"crm" | "email" | null>(null);
  const [query, setQuery] = useState("");
  const [typedName, setTypedName] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; success?: string }>({});
  const { results } = useSearch<Found>(
    inviting === "crm" && query.trim() ? `/dashboard/contacts/search?q=${encodeURIComponent(query.trim())}` : null,
  );

  const has = (key: string) => picked.some((each) => each.key === key);
  const contact = (person: { id: string; name: string }): Picked => ({
    key: person.id,
    label: person.name,
    person: { contactId: person.id },
  });
  function toggle(entry: Picked) {
    setPicked((current) => (current.some((each) => each.key === entry.key) ? current.filter((each) => each.key !== entry.key) : [...current, entry]));
  }
  // The account's button: everyone under it, or nobody if all are ticked.
  function toggleAccount(account: JobAccount) {
    const all = account.people.every((person) => has(person.id));
    setPicked((current) =>
      all
        ? current.filter((each) => !account.people.some((person) => person.id === each.key))
        : [...current, ...account.people.filter((person) => !has(person.id)).map(contact)],
    );
  }

  async function submit() {
    setBusy(true);
    const answer = await grantPhotoAccess(projectId, {
      folderId,
      role,
      sendEmail,
      people: picked.map((each) => each.person),
    });
    setBusy(false);
    setResult(answer);
    if (answer.success) {
      setPicked([]);
      router.refresh();
    }
  }

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  // On document.body: a glass card's blur would otherwise pin a fixed
  // overlay inside the card instead of over the screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="card popover my-8 w-full max-w-lg space-y-5 p-5" data-testid="grant-dialog">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="eyebrow">Grant access</p>
            <h2 className="text-base font-semibold">{folderName}</h2>
            <p className="faint text-xs">Each person gets their own link. Nobody outside your company can delete photos.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm !px-1.5">
            <IconX size={14} />
          </button>
        </div>

        <section className="space-y-2">
          <p className="label">Accounts on this job</p>
          {accounts.length === 0 && (
            <p className="faint text-xs">No companies are on this job yet. Invite people below.</p>
          )}
          <ul className="space-y-2">
            {accounts.map((account) => {
              const count = account.people.filter((person) => has(person.id)).length;
              const isOpen = expanded.includes(account.id);
              return (
                <li key={account.id} className="rounded-lg border border-[var(--border)]" data-testid="grant-account" data-name={account.name}>
                  <div className="flex items-center gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? expanded.filter((id) => id !== account.id) : [...expanded, account.id])}
                      className="btn btn-ghost btn-sm !px-1"
                      aria-label={isOpen ? "Hide people" : "Show people"}
                      data-testid="grant-account-expand"
                    >
                      {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <p className="faint text-xs">
                        {account.why} · {account.people.length} {account.people.length === 1 ? "person" : "people"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={account.people.length === 0}
                      onClick={() => toggleAccount(account)}
                      className={`btn btn-sm ${count && count === account.people.length ? "btn-primary" : "btn-ghost"}`}
                      data-testid="grant-account-all"
                    >
                      {count && count === account.people.length ? "All selected" : count ? `${count} selected` : "Select all"}
                    </button>
                  </div>
                  {isOpen && (
                    <ul className="space-y-1 border-t border-[var(--border)] p-2 pl-10">
                      {account.people.length === 0 && <li className="faint text-xs">Nobody at this company in your CRM yet.</li>}
                      {account.people.map((person) => (
                        <li key={person.id}>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={has(person.id)} onChange={() => toggle(contact(person))} data-testid="grant-person" data-name={person.name} />
                            <span>{person.name}</span>
                            <span className="faint truncate text-xs">{person.email ?? "no email"}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="label !mb-0">Invite Other Users</p>
            <button type="button" onClick={() => setInviting(inviting === "crm" ? null : "crm")} className={`btn btn-sm ${inviting === "crm" ? "btn-primary" : "btn-ghost"}`} data-testid="grant-invite-crm">
              Search your CRM
            </button>
            <button type="button" onClick={() => setInviting(inviting === "email" ? null : "email")} className={`btn btn-sm ${inviting === "email" ? "btn-primary" : "btn-ghost"}`} data-testid="grant-invite-email">
              Send via email
            </button>
          </div>
          {inviting === "crm" && (
            <div className="space-y-1">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, company or email" className="input" data-testid="grant-search" autoFocus />
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {results.map((found) => (
                  <li key={found.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={has(found.id)} onChange={() => toggle(contact(found))} data-testid="grant-search-result" data-name={found.name} />
                      <span>{found.name}</span>
                      <span className="faint truncate text-xs">{[found.company, found.email].filter(Boolean).join(" · ")}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inviting === "email" && (
            <div className="flex flex-wrap gap-2">
              <input value={typedName} onChange={(event) => setTypedName(event.target.value)} placeholder="Name" className="input min-w-0 flex-1" data-testid="grant-email-name" />
              <input value={typedEmail} onChange={(event) => setTypedEmail(event.target.value)} placeholder="email@company.com" type="email" className="input min-w-0 flex-1" data-testid="grant-email-address" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                data-testid="grant-email-add"
                onClick={() => {
                  const email = typedEmail.trim().toLowerCase();
                  if (!/^\S+@\S+\.\S+$/.test(email)) return setResult({ error: "That email doesn't look right" });
                  toggle({ key: `email:${email}`, label: typedName.trim() || email, person: { name: typedName.trim(), email } });
                  setTypedName("");
                  setTypedEmail("");
                  setResult({});
                }}
              >
                Add
              </button>
              <p className="faint w-full text-xs">Someone new is added to your CRM as a contact.</p>
            </div>
          )}
        </section>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="grant-picked">
            {picked.map((each) => (
              <span key={each.key} className="inline-flex items-center gap-1 rounded bg-[rgb(255_255_255/0.08)] px-2 py-1 text-xs">
                {each.label}
                <button type="button" onClick={() => toggle(each)} aria-label={`Remove ${each.label}`}>
                  <IconX size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <section className="space-y-2">
          <p className="label">What can they do?</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setRole("VIEW")} className={`btn ${role === "VIEW" ? "btn-primary" : "btn-ghost"} justify-center`} data-testid="grant-role-view">
              View only
            </button>
            <button type="button" onClick={() => setRole("EDIT")} className={`btn ${role === "EDIT" ? "btn-primary" : "btn-ghost"} justify-center`} data-testid="grant-role-edit">
              Editor
            </button>
          </div>
          <p className="faint text-xs">
            {role === "VIEW" ? "Looks at the photos and filters them." : "Also adds photos to this folder and changes tags. Never deletes."}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendEmail && emailOn} disabled={!emailOn} onChange={(event) => setSendEmail(event.target.checked)} data-testid="grant-send-email" />
            Email each person their link
          </label>
          {!emailOn && <p className="faint text-xs">Email isn&apos;t switched on for this site, so copy their links from the list instead.</p>}
        </section>

        <FormError message={result.error} />
        <FormSuccess message={result.success} />
        <button type="button" onClick={submit} disabled={busy || picked.length === 0} className="btn btn-primary w-full justify-center" data-testid="grant-submit">
          {busy ? "Granting…" : `Grant access${picked.length ? ` to ${picked.length}` : ""}`}
        </button>
      </div>
    </div>,
    document.body,

  );
}
