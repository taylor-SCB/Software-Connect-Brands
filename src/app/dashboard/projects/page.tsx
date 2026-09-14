import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { PageHeader, Card, EmptyState, StatusBadge, Meter } from "@/components/ui";
import { IconHardHat } from "@/components/icons";
import { leftCents } from "@/lib/projects";
import { getServiceTypes } from "@/lib/service-types";
import { OPEN_PROJECT_STAGES, PROJECT_STAGES, PROJECT_STAGE_LABELS, PAGE_SIZES, DEFAULT_PAGE_SIZE, type ProjectStageValue } from "@/lib/constants";
import { Pagination } from "@/components/pagination";
import { ProjectFilters } from "./project-filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Projects" };

// The won jobs. Live ones first; finished and cancelled ones only when
// asked for, so the list is what is actually on the books this week.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requireSession();
  const raw = await searchParams;
  const one = (key: string) => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const many = (key: string) => {
    const value = raw[key];
    return (Array.isArray(value) ? value : value ? [value] : []).slice(0, 20);
  };

  const q = (one("q") ?? "").replace(/[%_]/g, " ").trim().slice(0, 120);
  const stages = many("stage").filter((stage): stage is ProjectStageValue =>
    (PROJECT_STAGES as readonly string[]).includes(stage),
  );
  const serviceType = one("service") ?? "";
  const finished = one("finished") === "1";
  const perRaw = Number(one("per"));
  const per = (PAGE_SIZES as readonly number[]).includes(perRaw) ? perRaw : DEFAULT_PAGE_SIZE;
  const pageRaw = Number(one("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const and: Prisma.ProjectWhereInput[] = [{ organizationId }];
  if (q) {
    const number = Number(q.replace(/\D/g, ""));
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        ...(Number.isInteger(number) && number > 0 ? [{ number }] : []),
      ],
    });
  }
  if (stages.length) {
    and.push({ stage: { in: stages } });
  } else if (!finished) {
    and.push({ stage: { in: [...OPEN_PROJECT_STAGES] } });
  }
  if (serviceType) and.push({ scopes: { some: { serviceType } } });
  const where: Prisma.ProjectWhereInput = { AND: and };

  const [total, serviceTypes] = await Promise.all([
    prisma.project.count({ where }),
    getServiceTypes(organizationId),
  ]);
  const pages = Math.max(1, Math.ceil(total / per));
  const current = Math.min(page, pages);
  const skip = (current - 1) * per;

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip,
    take: per,
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      companyId: true,
      contactId: true,
      awardedCents: true,
      spentCents: true,
      committedCents: true,
      scopes: { select: { serviceType: true }, orderBy: { position: "asc" } },
    },
  });

  const hrefFor = (overrides: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    for (const stage of stages) search.append("stage", stage);
    if (serviceType) search.set("service", serviceType);
    if (finished) search.set("finished", "1");
    if (per !== DEFAULT_PAGE_SIZE) search.set("per", String(per));
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) search.delete(key);
      else search.set(key, value);
    }
    const query = search.toString();
    return query ? `/dashboard/projects?${query}` : "/dashboard/projects";
  };

  return (
    <div>
      <PageHeader
        eyebrow="Work"
        title="Projects"
        subtitle={`${total.toLocaleString()} ${total === 1 ? "job" : "jobs"}${q ? ` matching “${q}”` : ""}`}
      />

      <ProjectFilters
        q={q}
        stages={stages}
        serviceType={serviceType}
        finished={finished}
        per={per}
        serviceTypes={serviceTypes.filter((name) =>
          projects.some((project) => project.scopes.some((scope) => scope.serviceType === name)),
        )}
        allServiceTypes={serviceTypes}
      />

      <Card lit>
        {projects.length === 0 ? (
          <EmptyState
            icon={<IconHardHat size={20} />}
            title={q || stages.length ? "Nothing matches that" : "No jobs won yet"}
            body={
              q || stages.length
                ? "Try a different search, or turn on Show finished."
                : "A job lands here the moment a customer signs. You can also record one signed on paper from the Deal Tracker."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Stage</th>
                  <th className="w-56">Budget</th>
                  <th className="text-right">Left</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const left = leftCents(project);
                  const used = project.spentCents + project.committedCents;
                  return (
                    <tr key={project.id} data-testid="project-row">
                      <td className="font-medium">
                        <Link href={`/dashboard/projects/${project.id}`} className="link">
                          {project.name}
                        </Link>
                        <p className="faint num text-xs">PRJ-{project.number}</p>
                      </td>
                      <td className="muted text-sm">
                        {project.companyId ? (
                          <Link href={`/dashboard/companies/${project.companyId}`} className="link">
                            {project.customerName}
                          </Link>
                        ) : project.contactId ? (
                          <Link href={`/dashboard/contacts/${project.contactId}`} className="link">
                            {project.customerName}
                          </Link>
                        ) : (
                          project.customerName
                        )}
                      </td>
                      <td>
                        <StatusBadge status={project.stage} />
                      </td>
                      <td>
                        <Meter
                          height={10}
                          max={project.awardedCents}
                          segments={[
                            { cents: project.spentCents, tone: "spent" },
                            { cents: project.committedCents, tone: "committed" },
                          ]}
                          label={`${formatCents(used)} of ${formatCents(project.awardedCents)} used`}
                        />
                        <p className="faint num mt-1 text-[0.68rem]">
                          {formatCents(used)} of {formatCents(project.awardedCents)}
                        </p>
                      </td>
                      <td
                        className={`num text-right font-medium ${left < 0 ? "text-[var(--danger)]" : ""}`}
                        data-testid="project-left"
                        data-cents={left}
                      >
                        {left < 0 ? `Over by ${formatCents(-left)}` : formatCents(left)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              total={total}
              from={total === 0 ? 0 : skip + 1}
              to={Math.min(total, skip + per)}
              page={current}
              pages={pages}
              hrefFor={(next) => hrefFor({ page: next === 1 ? undefined : String(next) })}
              noun="jobs"
            />
          </div>
        )}
      </Card>

      {!finished && stages.length === 0 && total > 0 && (
        <p className="faint mt-3 text-xs">
          Finished and cancelled jobs are hidden. {PROJECT_STAGE_LABELS.COMPLETED} ones show with “Show finished”.
        </p>
      )}
    </div>
  );
}
