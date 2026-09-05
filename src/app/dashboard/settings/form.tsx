"use client";

import { useActionState } from "react";
import type { Organization } from "@/generated/prisma/client";
import { updateBranding } from "./actions";

export function BrandingForm({ organization }: { organization: Organization }) {
  const [state, formAction, pending] = useActionState<
    { error?: string; success?: boolean },
    FormData
  >(updateBranding, { error: undefined, success: false });

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Company name
        </label>
        <input
          id="name"
          name="name"
          defaultValue={organization.name}
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700">
          Logo URL
        </label>
        <input
          id="logoUrl"
          name="logoUrl"
          placeholder="https://..."
          defaultValue={organization.logoUrl ?? ""}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label htmlFor="primaryColor" className="block text-sm font-medium text-gray-700">
          Primary color
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="primaryColor"
            name="primaryColor"
            defaultValue={organization.primaryColor}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span
            className="h-9 w-9 flex-shrink-0 rounded-md border border-gray-300"
            style={{ backgroundColor: organization.primaryColor }}
          />
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: organization.primaryColor }}
      >
        {pending ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
