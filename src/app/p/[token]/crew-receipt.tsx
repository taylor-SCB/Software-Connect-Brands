"use client";

import { useRef, useState, useTransition } from "react";
import { IconCheck, IconUpload } from "@/components/icons";
import { pictureForAi } from "@/lib/ai-picture";
import { sendCrewReceipt } from "@/app/dashboard/projects/receipt-actions";

// "Send a receipt" on the crew photo link (Release C, Taylor's call 2): the
// photo is made small here and sent; the office checks it and approves it
// before it counts on the job. The installer's name is the one they typed
// for photos, remembered on this phone.
export function CrewReceipt({ token }: { token: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem("crew-photo-name") ?? "";
    } catch {
      return "";
    }
  });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [sent, setSent] = useState(0);

  function send(file: File) {
    setMessage(null);
    start(async () => {
      try {
        const base64 = await pictureForAi(file, 1568, 0.8);
        const result = await sendCrewReceipt(token, name, base64);
        start(() => {
          if (result.error) return setMessage({ text: result.error, error: true });
          setSent((count) => count + 1);
          setMessage({ text: result.success ?? "Sent." });
        });
      } catch (caught) {
        start(() => setMessage({ text: caught instanceof Error ? caught.message : "That photo couldn't be read.", error: true }));
      }
    });
  }

  return (
    <div className="space-y-3" data-testid="crew-receipt">
      <div>
        <label className="label" htmlFor="crew-receipt-who">
          Your name
        </label>
        <input
          id="crew-receipt-who"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            try {
              window.localStorage.setItem("crew-photo-name", event.target.value);
            } catch {}
          }}
          autoComplete="name"
          maxLength={80}
          className="input min-h-11"
          data-testid="crew-receipt-who"
          suppressHydrationWarning
        />
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        capture="environment"
        className="sr-only"
        data-testid="crew-receipt-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) send(file);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (!name.trim()) return setMessage({ text: "Put your name in first so the office knows who sent it.", error: true });
          input.current?.click();
        }}
        disabled={pending}
        className="btn btn-ghost min-h-11 w-full justify-center"
        data-testid="crew-receipt-pick"
      >
        <IconUpload size={16} />
        {pending ? "Sending…" : "Send a receipt"}
      </button>
      {message && (
        <p className={`text-sm ${message.error ? "text-[var(--danger)]" : "text-[var(--ok)]"}`} role={message.error ? "alert" : "status"} data-testid="crew-receipt-message">
          {!message.error && <IconCheck size={14} className="inline" />} {message.text}
        </p>
      )}
      {sent > 0 && <p className="faint text-xs">{sent} sent from this phone.</p>}
    </div>
  );
}
