"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FormError } from "@/components/ui";
import { setProjectProperty } from "../properties/actions";

// Which building this job is at. The other way in is the property's own
// page, which picks its jobs; this is the one you reach while looking at
// the job.
export function PropertyPicker({
  projectId,
  propertyId,
  properties,
}: {
  projectId: string;
  propertyId: string | null;
  properties: { id: string; name: string }[];
}) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  if (properties.length === 0) {
    return (
      <p className="faint text-xs">
        <Link href="/dashboard/projects/properties" className="link">
          Make a property
        </Link>{" "}
        to roll several jobs at one building into a single budget.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="block text-xs">
        <span className="faint block">At which property</span>
        <select
          value={propertyId ?? ""}
          disabled={pending}
          onChange={(fired) =>
            start(async () => {
              setError(undefined);
              const result = await setProjectProperty(projectId, fired.target.value);
              if (result?.error) setError(result.error);
            })
          }
          aria-label="Which property this job is at"
          id="project-property"
          className="select input-sm w-56"
          data-testid="project-property"
        >
          <option value="">No property</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      {propertyId && (
        <Link href={`/dashboard/projects/properties/${propertyId}`} className="link text-xs">
          Open the property
        </Link>
      )}
      <FormError message={error} />
    </div>
  );
}
