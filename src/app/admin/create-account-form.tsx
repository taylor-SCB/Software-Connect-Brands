"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconPlus, IconSend } from "@/components/icons";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import type { ActionState } from "@/lib/forms";
import { createAccount } from "./actions";

// Create Account on the operator console: a customer set up by hand,
// already approved, whose owner gets an email to set their own password.
export function CreateAccountForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createAccount, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Compared as an object, not as the message: two accounts in a row can
  // report the same words.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);
  const kept = state.kept ?? {};

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <FormSuccess message={state.success} />
        <button type="button" onClick={() => setOpen(true)} className="btn btn-primary btn-sm ml-auto">
          <IconPlus size={13} />
          Create Account
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3 px-5 py-4" data-testid="create-account-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="create-company">
            Company name
          </label>
          <input
            id="create-company"
            name="companyName"
            required
            defaultValue={kept.companyName}
            placeholder="Spirit Security"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="create-type">
            Account type
          </label>
          <select
            id="create-type"
            name="accountType"
            // Keyed on what came back, so a refused form shows the type that
            // was picked rather than snapping to the first one.
            key={kept.accountType ?? "BUSINESS"}
            defaultValue={kept.accountType ?? "BUSINESS"}
            className="select"
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACCOUNT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="create-first">
            Owner&apos;s first name
          </label>
          <input id="create-first" name="firstName" required defaultValue={kept.firstName} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="create-last">
            Owner&apos;s last name
          </label>
          <input id="create-last" name="lastName" required defaultValue={kept.lastName} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="create-email">
            Owner&apos;s email
          </label>
          <input
            id="create-email"
            name="email"
            type="email"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={kept.email}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="create-phone">
            Phone · optional
          </label>
          <input id="create-phone" name="phone" type="tel" defaultValue={kept.phone} className="input" />
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div>
            <label className="label" htmlFor="create-city">
              City · optional
            </label>
            <input id="create-city" name="city" defaultValue={kept.city} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="create-state">
              State
            </label>
            <input id="create-state" name="state" defaultValue={kept.state} placeholder="NE" className="input" />
          </div>
        </div>
      </div>
      <p className="faint text-xs">
        The account opens already approved. The owner gets an email from Software Connect Brands with a link to set
        their own password; it lasts 7 days and works once. A Distributor, Hardware / OEM or Software Provider is
        listed in other businesses&apos; supplier pickers by name, city and state.
      </p>
      <FormError message={state.error} />
      <FormSuccess message={state.success} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Close
        </button>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          <IconSend size={13} />
          {pending ? "Creating…" : "Create and send link"}
        </button>
      </div>
    </form>
  );
}
