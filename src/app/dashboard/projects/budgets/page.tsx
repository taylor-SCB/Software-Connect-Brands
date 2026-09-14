import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { PageHeader, Card, CardHeader, EmptyState, StatusBadge, Meter } from "@/components/ui";
import { IconTrending } from "@/components/icons";
import { leftCents } from "@/lib/projects";
import { OPEN_PROJECT_STAGES } from "@/lib/constants";

export const metadata = { title: "Budgets" };

// Every live job's bar on one page, tightest first: where the money is
// about to run out is the thing worth seeing at a glance.
export default async function BudgetsPage() {
  const { organizationId } = await requireSession();

  const projects = await prisma.project.findMany({
    where: { organizationId, stage: { in: [...OPEN_PROJECT_STAGES] } },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      awardedCents: true,
      spentCents: true,
      committedCents: true,
      billedCents: true,
      receivedCents: true,
      scopes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          awardedCents: true,
          spentCents: true,
          committedCents: true,
          isDefault: true,
        },
      },
    },
  });

  const rows = projects
    .map((project) => ({ ...project, left: leftCents(project) }))
    .sort((a, b) => a.left - b.left);

  const totals = rows.reduce(
    (sum, row) => ({
      awarded: sum.awarded + row.awardedCents,
      used: sum.used + row.spentCents + row.committedCents,
      owed: sum.owed + (row.billedCents - row.receivedCents),
    }),
    { awarded: 0, used: 0, owed: 0 },
  );

  return (
    <div>
      <PageHeader
        eyebrow="Work · Projects"
        title="Budgets"
        subtitle={
          rows.length === 0
            ? "Every live job's budget, tightest first."
            : `${rows.length} live ${rows.length === 1 ? "job" : "jobs"} · ${formatCents(totals.awarded)} awarded · ${formatCents(totals.owed)} still owed to you`
        }
      />

      {rows.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconTrending size={20} />}
            title="No live jobs"
            body="A job shows here from the moment a customer signs until you mark it finished."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((project) => {
            const used = project.spentCents + project.committedCents;
            const scopes = project.scopes.filter(
              (scope) => project.scopes.length > 1 && scope.awardedCents !== 0,
            );
            return (
              <Card lit key={project.id}>
                <CardHeader
                  title={project.name}
                  subtitle={`PRJ-${project.number} · ${project.customerName}`}
                  actions={
                    <div className="flex items-center gap-2">
                      <StatusBadge status={project.stage} />
                      <Link href={`/dashboard/projects/${project.id}`} className="btn btn-ghost btn-sm">
                        Open
                      </Link>
                    </div>
                  }
                />
                <div className="space-y-3 p-5" data-testid="budget-row" data-project-id={project.id}>
                  <Meter
                    max={project.awardedCents}
                    segments={[
                      { cents: project.spentCents, tone: "spent" },
                      { cents: project.committedCents, tone: "committed" },
                    ]}
                    label={`${formatCents(used)} of ${formatCents(project.awardedCents)} used`}
                  />
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span className="muted">
                      Awarded <span className="num font-medium">{formatCents(project.awardedCents)}</span>
                    </span>
                    <span className="muted">
                      Used <span className="num font-medium">{formatCents(used)}</span>
                    </span>
                    <span className="muted">
                      Left{" "}
                      <span className={`num font-medium ${project.left < 0 ? "text-[var(--danger)]" : ""}`}>
                        {project.left < 0 ? `Over by ${formatCents(-project.left)}` : formatCents(project.left)}
                      </span>
                    </span>
                    <span className="muted">
                      Still owed to you{" "}
                      <span className="num font-medium">
                        {formatCents(project.billedCents - project.receivedCents)}
                      </span>
                    </span>
                  </div>
                  {scopes.length > 0 && (
                    <ul className="space-y-2 border-t border-[rgb(255_255_255/0.06)] pt-3">
                      {scopes.map((scope) => {
                        const scopeLeft = leftCents(scope);
                        return (
                          <li key={scope.id}>
                            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                              <span className="muted">{scope.name}</span>
                              <span className={`num ${scopeLeft < 0 ? "text-[var(--danger)]" : "faint"}`}>
                                {scopeLeft < 0
                                  ? `Over by ${formatCents(-scopeLeft)}`
                                  : `Left ${formatCents(scopeLeft)} of ${formatCents(scope.awardedCents)}`}
                              </span>
                            </div>
                            <Meter
                              height={8}
                              max={scope.awardedCents}
                              segments={[
                                { cents: scope.spentCents, tone: "spent" },
                                { cents: scope.committedCents, tone: "committed" },
                              ]}
                              label={`${scope.name}: ${formatCents(scope.spentCents + scope.committedCents)} of ${formatCents(scope.awardedCents)} used`}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
