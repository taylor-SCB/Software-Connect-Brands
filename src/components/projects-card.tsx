import Link from "next/link";
import { formatCents } from "@/lib/format";
import { Card, CardHeader, StatusBadge, Meter } from "@/components/ui";
import { leftCents } from "@/lib/projects";

type ProjectRow = {
  id: string;
  number: number;
  name: string;
  stage: string;
  awardedCents: number;
  spentCents: number;
  committedCents: number;
};

// The jobs won for a company or a person, on their page. Nothing shows
// until there is one, so the page stays quiet for a lead.
export function ProjectsCard({ projects }: { projects: ProjectRow[] }) {
  if (projects.length === 0) return null;
  return (
    <Card lit>
      <CardHeader
        title="Jobs"
        subtitle={`${projects.length} won ${projects.length === 1 ? "job" : "jobs"}`}
      />
      <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
        {projects.map((project) => {
          const left = leftCents(project);
          return (
            <li key={project.id} className="px-5 py-3" data-testid="project-card-row">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/dashboard/projects/${project.id}`} className="link text-sm font-medium">
                  {project.name}
                </Link>
                <StatusBadge status={project.stage} />
              </div>
              <p className="faint num text-xs">
                PRJ-{project.number} ·{" "}
                <span className={left < 0 ? "text-[var(--danger)]" : ""}>
                  {left < 0 ? `over by ${formatCents(-left)}` : `${formatCents(left)} left`}
                </span>{" "}
                of {formatCents(project.awardedCents)}
              </p>
              <div className="mt-1.5">
                <Meter
                  height={6}
                  max={project.awardedCents}
                  segments={[
                    { cents: project.spentCents, tone: "spent" },
                    { cents: project.committedCents, tone: "committed" },
                  ]}
                  label={`${project.name}: ${formatCents(project.spentCents + project.committedCents)} of ${formatCents(project.awardedCents)} used`}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
