import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { aiConfigured } from "@/lib/ai";
import { PageHeader } from "@/components/ui";
import { cleanCriteria, loadPlanned, plannerChoices, PLANNER_KINDS } from "@/lib/planner";
import { CONTACT_STATUS_LABELS } from "@/lib/constants";
import { Planner } from "./planner";

type Params = Record<string, string | string[] | undefined>;

const list = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []);

// Planner AI (Nov 12, 2026; Taylor). Plan: describe the leads (typed, or
// turned into filters by AI), pick Warm / Cold / Mix, set up to 6 dated
// touches, Generate, review, Create. Planned: what the planner put on your
// calendar that is still open. Opened from the Calendar's toolbar, the
// dashboard's box (?q=…) and the Contacts list's Plan outreach (its filters
// in the address: title, industry, type, status, state, city, never=1).
export default async function PlannerPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { organizationId, userId } = await requireSession();
  const params = await searchParams;
  const [timeZone, choices, planned] = await Promise.all([getTimeZone(), plannerChoices(organizationId), loadPlanned(organizationId, userId)]);
  const today = todayIso(timeZone);
  const criteria = cleanCriteria(
    {
      titles: list(params.title),
      industries: list(params.industry),
      companyTypes: list(params.type),
      statuses: list(params.status),
      states: list(params.state),
      cities: list(params.city),
      neverContacted: params.never === "1",
    },
    choices,
  );
  const kind = PLANNER_KINDS.find((value) => value === params.kind) ?? null;
  const text = typeof params.q === "string" ? params.q.slice(0, 600) : "";
  const tab = params.tab === "planned" ? "planned" : "plan";
  const statusLabels = Object.fromEntries(choices.statuses.map((status) => [status, CONTACT_STATUS_LABELS[status as keyof typeof CONTACT_STATUS_LABELS] ?? status]));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Planner"
        subtitle="Describe who to reach, pick the days, and the planner puts up to 50 people on your own calendar."
      />
      <Planner
        today={today}
        tab={tab}
        choices={choices}
        statusLabels={statusLabels}
        initial={{ criteria, kind, text }}
        ai={aiConfigured()}
        planned={planned}
      />
    </div>
  );
}
