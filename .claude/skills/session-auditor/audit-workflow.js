export const meta = {
  name: 'session-auditor',
  description: 'Audit one session\'s diff: parallel finders per area, dedupe, one quick skeptic per distinct defect, ranked result',
  whenToUse: 'Invoked by the session-auditor skill with args { repo, base, areas: [{ key, prompt }] }',
  phases: [
    { title: 'Find', detail: 'one read-only finder per area, one round' },
    { title: 'Verify', detail: 'dedupe, then one fast skeptic per distinct defect' },
  ],
}

// ---- inputs ------------------------------------------------------------
const REPO = args?.repo || '/home/user/Software-Connect-Brands'
const BASE = args?.base
const AREAS = Array.isArray(args?.areas) ? args.areas : []
if (!BASE) throw new Error('args.base (the base commit sha) is required')
if (AREAS.length === 0) throw new Error('args.areas must list at least one { key, prompt }')

const CONTEXT = `
You are auditing ONE session's changes to a Next.js 16 + Prisma 7 + Postgres CRM at ${REPO}.
The changes are the diff \`git -C ${REPO} diff ${BASE}..HEAD\`. Read the real code on disk, not just the diff.
Read node_modules/next/dist/docs/ if you need to check a Next.js 16 API; this Next differs from older training data.

A local Postgres is on port 5433 (DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test) holding test
workspaces, and the built app is running at http://localhost:3000. You MAY run read-only probes (psql via
su postgres -c "/usr/lib/postgresql/16/bin/psql -p 5433 -d scb_test ...", curl, or a throwaway tsx script under /tmp).
You MUST NOT edit, create or delete any file inside ${REPO}, and MUST NOT commit, push, or touch git state.

Report only REAL defects: wrong output, data loss or corruption, a crash, a cross-tenant leak, a security hole, a broken
user flow, a React runtime or hydration error, a migration that would fail or damage existing rows, or a performance
cliff at a few hundred thousand rows. Not style, not naming, not "could be simpler", not hypothetical refactors.
Every finding needs a concrete trigger (exact input, clicks or data state) and the exact wrong result.
Prefer fewer, certain findings over many speculative ones, but sweep your whole area.
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          trigger: { type: 'string' },
          wrong: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['file', 'line', 'title', 'severity', 'trigger', 'wrong', 'evidence'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['refuted', 'reason', 'severity'],
}

const DEDUP = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          indexes: { type: 'array', items: { type: 'integer' } },
          title: { type: 'string' },
        },
        required: ['indexes', 'title'],
      },
    },
  },
  required: ['groups'],
}

// ---- 1. find ------------------------------------------------------------
log(`Finding: ${AREAS.length} areas over ${BASE.slice(0, 7)}..HEAD`)
const rounds = await parallel(
  AREAS.map((area) => () =>
    agent(`${CONTEXT}\n${area.prompt}\nReturn your findings as the structured output. An empty list is a valid answer if your area is clean.`,
      { label: `find:${area.key}`, phase: 'Find', schema: FINDINGS })),
)
let found = rounds.filter(Boolean).flatMap((r) => r.findings || [])
log(`${found.length} flags reported`)

// A thin diff can deserve one more look; a rich one never does.
if (found.length < 5) {
  const again = await parallel(
    AREAS.map((area) => () =>
      agent(`${CONTEXT}\n${area.prompt}\nAlready reported (do not repeat):\n${found.map((f) => `- ${f.file}:${f.line} ${f.title}`).join('\n') || '- nothing'}\nLook again, harder, for what was missed.`,
        { label: `find2:${area.key}`, phase: 'Find', schema: FINDINGS })),
  )
  found = found.concat(again.filter(Boolean).flatMap((r) => r.findings || []))
  log(`${found.length} flags after the second look`)
}

// ---- 2. dedupe ----------------------------------------------------------
let groups = []
if (found.length > 0) {
  const dedup = await agent(`Group these bug findings so that each group is ONE distinct defect (same root cause, even if phrased
differently or found in different files). Every index must appear in exactly one group. Work from the text only; do not read code.
${found.map((f, i) => `[${i}] ${f.file}:${f.line} — ${f.title} :: ${f.wrong.slice(0, 220)}`).join('\n')}`,
    { label: 'dedupe', phase: 'Verify', schema: DEDUP, effort: 'low' })
  groups = (dedup?.groups || []).filter((g) => g.indexes && g.indexes.length)
  const covered = new Set(groups.flatMap((g) => g.indexes))
  found.forEach((f, i) => { if (!covered.has(i)) groups.push({ indexes: [i], title: f.title }) })
}
log(`${groups.length} distinct defects; one skeptic each`)

// ---- 3. verify ----------------------------------------------------------
const judged = await parallel(
  groups.map((g) => () => {
    const members = g.indexes.map((i) => found[i]).filter(Boolean)
    const f = members[0]
    return agent(`${CONTEXT}
You are a skeptic. Finders claim this defect (reported ${members.length} time${members.length === 1 ? '' : 's'}):
${members.map((m) => `  - ${m.file}:${m.line} ${m.title}\n    trigger: ${m.trigger}\n    wrong: ${m.wrong}\n    evidence: ${m.evidence}`).join('\n')}
Read the actual current code on that path and decide whether the wrong behaviour really happens from the described trigger.
Be quick: no browser automation; at most one small psql or tsx probe if it settles the question. Default to refuted=true when uncertain.
Set refuted=false ONLY if you are confident a user of this CRM could hit it. Severity: high = data loss / corruption / security /
a broken main flow; medium = wrong results in a common case; low = rare edge. Do not edit any file in the repo.`,
      { label: `verify:${f.file.split('/').pop()}:${g.indexes[0]}`, phase: 'Verify', schema: VERDICT, effort: 'medium' })
      .then((v) => ({ finding: { ...f, title: g.title || f.title, reports: members.length }, verdict: v, stands: Boolean(v) && !v.refuted }))
  }),
)

const confirmed = judged.filter((j) => j && j.stands)
const rejected = judged.filter((j) => j && !j.stands)
log(`${confirmed.length} confirmed, ${rejected.length} refuted`)

const rank = { high: 0, medium: 1, low: 2 }
const sev = (j) => (j.verdict && j.verdict.severity) || j.finding.severity
confirmed.sort((a, b) => rank[sev(a)] - rank[sev(b)] || b.finding.reports - a.finding.reports)
return {
  flagged: found.length,
  distinct: groups.length,
  confirmed: confirmed.map((j) => ({ severity: sev(j), ...j.finding, why: j.verdict ? j.verdict.reason : '' })),
  rejected: rejected.map((j) => ({ ...j.finding, why: j.verdict ? j.verdict.reason : 'no verdict' })),
}
