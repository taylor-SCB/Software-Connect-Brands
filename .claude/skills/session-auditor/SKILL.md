---
name: session-auditor
description: Audit the current session's code changes for real bugs, verify each one quickly, fix everything confirmed, add a regression test per fix, tie it all out, then ask about going live. Use when Taylor says "audit this session", "run the bug audit", or "/session-auditor".
---

# Session auditor

Taylor asked for this after the first audit (Sept 13, 2026) took an hour
because every one of 40 flags got three slow skeptics with browser
probes. The finding part took five minutes and was right. The checking
part was the waste. This is the short version, and it still has to find
the bugs, fix them, and tie them out.

**Time budget: finders about 5 minutes, verification about 5 minutes.**
If it is heading past 15 minutes total, cut the verification, never the
finding.

## 1. Scope it inline (no agents)

- Base commit: `git merge-base HEAD origin/claude/first-app-creation-cdtbrb`
  (the live branch). If the session has its own first commit, use that.
- `git diff --name-only <base>..HEAD` — the whole list is the audit scope.
  Docs and tests are in scope only for "a documented promise the code
  does not keep".
- Group the files into 4 to 8 **areas**, one finder each. Every area gets
  one paragraph that names its files and lists what to hunt for
  (concrete failure modes, not "check for bugs"). Always include:
  - a **security / tenant scoping** area (every query filtered by the
    session's organizationId, client input trusted, unbounded input,
    injection, javascript: links),
  - a **regressions elsewhere** area (every other caller of a changed
    component or function, grep the whole `src` tree, nav, docs vs code).
- Make sure the local Postgres on 5433 and the built app on
  `localhost:3000` are running, so finders can probe read-only.

## 2. Run the workflow

Use the checked-in script, with the areas as args:

```
Workflow({
  scriptPath: ".claude/skills/session-auditor/audit-workflow.js",
  args: { repo: "/home/user/Software-Connect-Brands", base: "<sha>", areas: [{ key, prompt }, ...] }
})
```

What the script does, and the rules baked into it:

- **One round** of finders, all areas in parallel. No second round
  unless round one found fewer than 5 things. No "critic" pass.
- **Dedupe first**: plain code plus one cheap agent groups the flags into
  distinct defects (the tag-wipe bug was reported four times).
- **One skeptic per distinct defect**, medium effort, reads the real
  code, at most one small psql/tsx probe, **no browser automation**.
  Default to refuted when uncertain. Never three lenses per finding.
- Finders and skeptics are **read-only**: they never edit, commit or
  push. Don't touch the repo yourself while they run, or the skeptics
  judge code that no longer matches the findings.
- Output: `confirmed[]` and `rejected[]`, each with file, line, title,
  trigger, wrong result, evidence and the skeptic's reason.

## 3. Report to Taylor (gears 1 and 2, under 300 words)

A small table: flagged, distinct, confirmed, refuted. Then the confirmed
list in plain words, worst first, grouped by area, one line each with
what a user would see. Say nothing is live. Say what you will do next
(fix, retest, push the working branch, ask about going live). Do not
paste evidence or code.

## 4. Fix everything confirmed

Fixing confirmed bugs in unreleased code needs no permission. Rules:

- Fix the root cause, not the symptom the finder happened to hit.
- **Every fix gets a regression step** in the checked-in browser suite
  for that module (`scripts/browser-tests/`), asserting the exact wrong
  behaviour no longer happens. Group them into one or two steps titled
  "audit fixes: ...".
- No refactors, renames or moves along the way. Taylor's rule.
- Update README / CLAUDE.md where a fix changed a documented behaviour.

Then: lint, typecheck, `npm run build:app`, restart the app, run the
module's suite, then **every** checked-in suite and the load test, one
at a time. All green before anything is pushed. Commit with a message
that lists the fixes by area. Push the working branch.

## 5. Tie it out

Before the release question, show a tie-out table: one row per confirmed
finding → the fix (file) → the test step that proves it. Any finding not
fixed gets a one-line reason and goes into CLAUDE.md's Known gaps. A
refuted finding that turns out real on a second look is fixed, not
argued.

## 6. Release

Only then, exactly as CLAUDE.md says: **"Ready to go live. Push to
production? Yes or No."** On yes, push to the live branch (this needs
Taylor's permission click; the push is treated as a production deploy),
then ask about the CTO report.

## Don'ts

- Don't run three skeptics per finding. Don't let skeptics drive a browser.
- Don't run a second finder round on a diff that already produced 20+ flags.
- Don't report unverified flags as bugs, and don't hide refuted ones; list them.
- Don't start fixing before the workflow returns.
- Don't widen the audit into the rest of the codebase; the diff is the scope.
