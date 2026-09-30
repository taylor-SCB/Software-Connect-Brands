"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearch } from "@/lib/use-search";
import { addExistingPersonToCompany } from "@/app/dashboard/contacts/account-actions";
import type { PersonHit } from "@/components/add-person-search";

// The Contact name box on a new contact. As the name is typed it checks
// who is already in the workspace and lists them with their email, phone
// and company, so a second Matt Smith is a choice and not an accident.
// Opened from a company page, each match can be added to that company
// instead of creating a duplicate.
export function ContactNameField({
  defaultValue,
  company,
}: {
  defaultValue: string;
  company: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultValue);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const q = name.trim();
  const { results } = useSearch<PersonHit>(q.length >= 2 ? `/dashboard/contacts/search?q=${encodeURIComponent(q)}` : null, 250);
  const matches = q.length >= 2 ? results.filter((person) => person.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5) : [];

  return (
    <div>
      <label className="label" htmlFor="name">
        Contact name
      </label>
      <input
        id="name"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Sam Rivera"
        required
        autoComplete="off"
        className="input"
      />
      {matches.length > 0 && (
        <div className="mt-2 rounded-lg border border-[var(--warn)]/40 bg-[rgb(251_191_36/0.06)] p-2.5" data-testid="duplicate-matches">
          <p className="mb-1.5 text-xs text-[var(--warn)]">Already in your contacts — is it one of these?</p>
          <ul className="space-y-1.5">
            {matches.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{person.name}</span>
                  <span className="faint block truncate">
                    {[person.email, person.phone, person.company].filter(Boolean).join(" · ") || "No email or phone on file"}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Link href={`/dashboard/contacts/${person.id}`} className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                  {company && person.companyId !== company.id && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setError(undefined);
                          const result = await addExistingPersonToCompany(company.id, person.id);
                          if (result.error) setError(result.error);
                          else router.push(`/dashboard/companies/${company.id}#people`);
                        })
                      }
                      className="btn btn-primary btn-sm"
                      data-testid="duplicate-link"
                    >
                      Add to {company.name}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
