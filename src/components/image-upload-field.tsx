"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { IconUpload, IconX } from "@/components/icons";

// A picture on a record: shows what is there, lets the user pick a new
// file (previewed before saving) or tick Remove. Sends the file as
// `<name>File` and the remove flag as `remove<Name>` so the action can
// tell the three cases apart.
export function ImageUploadField({
  label,
  name,
  currentUrl,
  fallback,
  hint,
  disabled = false,
  shape = "square",
}: {
  label: string;
  name: string;
  currentUrl: string | null;
  // Letter(s) drawn when there is no picture.
  fallback: string;
  hint?: string;
  disabled?: boolean;
  shape?: "square" | "round";
}) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);

  // The picked file previewed before it is saved; the object URL is
  // released when the pick changes.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const shown = preview ?? (remove ? null : currentUrl);
  const radius = shape === "round" ? "rounded-full" : "rounded-xl";
  const removeName = `remove${name.charAt(0).toUpperCase()}${name.slice(1)}`;

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-center gap-4">
        {shown ? (
          // Tenant-supplied picture; next/image would need per-tenant
          // remote host config, so a plain img is the right call.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt=""
            data-testid={`${name}-preview`}
            className={`h-16 w-16 border border-[var(--border)] object-cover ${radius}`}
          />
        ) : (
          <div
            data-testid={`${name}-fallback`}
            className={`flex h-16 w-16 items-center justify-center text-lg font-bold text-white ${radius}`}
            style={{ background: "var(--brand)" }}
          >
            {fallback}
          </div>
        )}
        <div className="space-y-2">
          <label
            htmlFor={inputId}
            className={`btn btn-ghost btn-sm cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`}
          >
            <IconUpload size={13} />
            {shown ? "Replace image" : "Upload image"}
          </label>
          <input
            id={inputId}
            type="file"
            name={`${name}File`}
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={disabled}
            className="sr-only"
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null;
              setFile(picked);
              if (picked) setRemove(false);
            }}
          />
          {(currentUrl || file) && !disabled && (
            <div className="flex flex-wrap items-center gap-2">
              {file && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFile(null)}
                >
                  <IconX size={12} />
                  Undo
                </button>
              )}
              {currentUrl && !file && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    name={removeName}
                    value="true"
                    checked={remove}
                    onChange={(event) => setRemove(event.target.checked)}
                  />
                  Remove current image
                </label>
              )}
            </div>
          )}
          {file && <p className="faint text-xs">{file.name} · saved with the form</p>}
        </div>
      </div>
      {hint && <p className="faint mt-1 text-xs">{hint}</p>}
    </div>
  );
}
