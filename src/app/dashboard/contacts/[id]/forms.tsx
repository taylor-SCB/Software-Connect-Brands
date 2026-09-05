"use client";

import { useActionState } from "react";
import { addNote, createDealForContact } from "../actions";

export function AddNoteForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(
    addNote,
    { error: undefined },
  );

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="contactId" value={contactId} />
      <textarea
        name="body"
        rows={2}
        placeholder="Add a note..."
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Adding..." : "Add note"}
      </button>
    </form>
  );
}

export function AddDealForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(
    createDealForContact,
    { error: undefined },
  );

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="contactId" value={contactId} />
      <div>
        <label className="block text-xs font-medium text-gray-700">Deal title</label>
        <input
          name="title"
          required
          className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Value ($)</label>
        <input
          name="value"
          type="number"
          min="0"
          step="0.01"
          className="mt-1 w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Adding..." : "Add deal"}
      </button>
    </form>
  );
}
