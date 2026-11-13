"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconSparkles } from "@/components/icons";

// The dashboard's planner box (Planner AI, Nov 12, 2026): type who you want
// to reach and Plan opens the Planner with those words turned into filters.
export function PlannerBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  return (
    <form
      className="card flex min-w-0 flex-wrap items-center gap-2 p-3 sm:flex-nowrap sm:px-4"
      data-testid="planner-box"
      onSubmit={(event) => {
        event.preventDefault();
        const words = text.trim();
        router.push(words ? `/dashboard/planner?q=${encodeURIComponent(words)}` : "/dashboard/planner");
      }}
    >
      <IconSparkles size={15} className="shrink-0 opacity-70" />
      <input
        type="text"
        value={text}
        maxLength={600}
        onChange={(event) => setText(event.target.value)}
        placeholder="Plan outreach: e.g. property managers in Texas we've never called"
        aria-label="Plan outreach"
        className="input min-w-0 flex-1 basis-56"
        data-testid="planner-box-input"
      />
      <button type="submit" className="btn btn-primary btn-sm pointer-coarse:min-h-11 shrink-0" data-testid="planner-box-go">
        Plan
      </button>
    </form>
  );
}
