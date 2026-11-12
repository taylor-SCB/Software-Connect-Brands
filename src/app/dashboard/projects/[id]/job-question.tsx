"use client";

import { useState, useTransition } from "react";
import { IconSparkles } from "@/components/icons";
import { askJobQuestion } from "../question-actions";

// C6 "Ask the job a question" (Release C, Nov 12, 2026): answered from this
// job's own numbers only; an answer with a number that isn't one of them
// is refused on the server. Nothing is stored: the answer lives on this
// page until the next question.
export function JobQuestion({ projectId }: { projectId: string }) {
  const [question, setQuestion] = useState("");
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState<{ text: string; error?: boolean; asked: string } | null>(null);

  function ask(event: React.FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked) return;
    start(async () => {
      const result = await askJobQuestion(projectId, asked);
      start(() => setAnswer("error" in result ? { text: result.error, error: true, asked } : { text: result.answer, asked }));
    });
  }

  return (
    <div className="space-y-2" data-testid="job-question">
      <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="job-question-input" className="sr-only">
          Ask about this job
        </label>
        <input
          id="job-question-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={300}
          placeholder="Are we over on electrical?"
          className="input min-h-11 min-w-0 flex-1"
          data-testid="job-question-input"
        />
        <button type="submit" disabled={pending || !question.trim()} className="btn btn-primary min-h-11" data-testid="job-question-ask">
          <IconSparkles size={14} />
          {pending ? "Looking at the numbers…" : "Ask"}
        </button>
      </form>
      {answer && (
        <div aria-live="polite" className="space-y-1">
          <p className="faint text-xs">You asked: {answer.asked}</p>
          <p className={`text-sm ${answer.error ? "text-[var(--danger)]" : ""}`} data-testid={answer.error ? "job-question-error" : "job-question-answer"}>
            {answer.text}
          </p>
        </div>
      )}
      <p className="faint text-xs">Answered only from this job&apos;s own numbers: budget, bills, change orders, crew time and schedule.</p>
    </div>
  );
}
