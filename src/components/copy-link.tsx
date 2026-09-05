"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@/components/icons";

// The public document URL is only known in full in the browser (the
// server doesn't reliably know the external host), so the path is passed
// in and resolved against window.location here.
export function CopyLink({ path, label = "Copy link" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard is blocked in some embedded browsers; select-and-copy
      // from the visible field still works, so fail quietly.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" onClick={copy} className="btn btn-ghost btn-sm">
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function PublicLinkField({ path }: { path: string }) {
  const [origin, setOrigin] = useState("");

  // Read the origin after mount; rendering it during SSR would produce
  // markup the client can't match.
  if (typeof window !== "undefined" && origin === "") {
    setOrigin(window.location.origin);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={origin ? `${origin}${path}` : path}
        onFocus={(event) => event.currentTarget.select()}
        className="input input-sm num min-w-0 flex-1 text-xs"
        aria-label="Public document link"
      />
      <CopyLink path={path} />
    </div>
  );
}
