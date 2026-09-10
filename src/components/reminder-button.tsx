"use client";

import { useState, useTransition } from "react";
import { IconSend, IconCheck } from "@/components/icons";
import { logReminder } from "@/app/dashboard/deals/tracker/actions";

// "Send reminder" without email: composes the nudge, copies it to the
// clipboard for the user to text or email, and logs that it went out.
export function ReminderButton({
  contractId,
  message,
  path,
  compact = false,
}: {
  contractId: string;
  // The reminder text with {{link}} where the signing link goes.
  message: string;
  path: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [pending, startTransition] = useTransition();

  function send() {
    const link = `${window.location.origin}${path}`;
    const text = message.replace("{{link}}", link);
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard can be blocked (insecure origin, permissions); the
        // reminder is still logged and the text shown in the prompt.
        window.prompt("Copy this reminder:", text);
      }
      const result = await logReminder(contractId);
      setState(result.error ? "error" : "done");
      setTimeout(() => setState("idle"), 2500);
    });
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={pending}
      className={`btn btn-ghost btn-sm ${compact ? "" : "w-full"}`}
      title="Copies a reminder with the signing link and logs it. Nothing is emailed from the app yet."
      data-testid="reminder-button"
    >
      {state === "done" ? <IconCheck size={13} /> : <IconSend size={13} />}
      {state === "done" ? "Copied · logged" : state === "error" ? "Couldn't log" : "Copy reminder"}
    </button>
  );
}
