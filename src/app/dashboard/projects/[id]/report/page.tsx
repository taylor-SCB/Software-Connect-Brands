import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { aiConfigured } from "@/lib/ai";
import { absoluteUrl } from "@/lib/app-url";
import { PageHeader, Card, CardHeader, StatusBadge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { cleanPairs, jobReportPhotos } from "@/lib/photo-report";
import { ReportEditor } from "./report-editor";

// C3, the close-out photo report (Release C, Nov 12, 2026): reached from
// "Make a photo report" beside Close out on the job page. The person
// edits the pairs and their words, saves, and shares a link with the
// customer (/jr/<token>) that can be turned off again.
export default async function PhotoReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      photoReport: { select: { token: true, summary: true, pairs: true, shared: true } },
      contact: { select: { name: true, phone: true, mobile: true, email: true } },
    },
  });
  if (!project) notFound();

  const photos = await jobReportPhotos(organizationId, project.id);
  const allowed = new Set(photos.map((photo) => photo.id));
  const report = project.photoReport;

  return (
    <div>
      <BackLink href={`/dashboard/projects/${project.id}`} label={project.name} current="Photo report" />
      <PageHeader
        eyebrow={`Job · PRJ-${project.number}`}
        title="Photo report"
        subtitle={`${project.name} · ${project.customerName}`}
        actions={<StatusBadge status={project.stage} />}
      />
      <Card lit>
        <CardHeader
          title="Before and after"
          subtitle="Pairs of photos with a line each, and a short summary. Edit anything, then save. The customer sees it only once you share it."
        />
        <ReportEditor
          projectId={project.id}
          photos={photos}
          aiOn={aiConfigured()}
          saved={
            report
              ? {
                  // Built here with the site's own address (audit fix: built in
                  // the browser, Text and Email kept a link with no host after
                  // a reload).
                  url: await absoluteUrl(`/jr/${report.token}`),
                  summary: report.summary,
                  pairs: cleanPairs(report.pairs, allowed),
                  shared: report.shared,
                }
              : null
          }
          customer={{
            name: project.contact?.name ?? project.customerName,
            phone: project.contact?.mobile || project.contact?.phone || null,
            email: project.contact?.email ?? null,
          }}
          jobName={project.name}
        />
      </Card>
    </div>
  );
}
