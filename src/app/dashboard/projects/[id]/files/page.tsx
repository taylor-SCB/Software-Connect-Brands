import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { fileUrl } from "@/lib/uploads";
import { PageHeader, Card, CardHeader, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconFileText, IconDownload, IconTrash } from "@/components/icons";
import { ProjectTabs } from "../project-tabs";
import { ProjectFileForm } from "./project-file-form";
import { deleteProjectFile } from "../../actions";

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Everything that belongs to the job but is not a number: photos from
// site, receipts, permits, and the other party's own contract when
// theirs was the paper that got signed.
export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const timeZone = await getTimeZone();

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      uploads: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          fileName: true,
          category: true,
          sizeBytes: true,
          publicToken: true,
          createdAt: true,
        },
      },
    },
  });
  if (!project) notFound();

  return (
    <div>
      <BackLink href={`/dashboard/projects/${project.id}`} label={project.name} />

      <PageHeader
        eyebrow={`Job · PRJ-${project.number}`}
        title="Files"
        subtitle={`${project.name} · ${project.customerName}`}
        actions={<StatusBadge status={project.stage} />}
      />

      <ProjectTabs projectId={project.id} current="files" />

      <div className="space-y-5">
        <Card lit>
          <CardHeader
            title="Add a file"
            subtitle="Up to 4 MB each. Only people logged in to this workspace can open them."
          />
          <ProjectFileForm projectId={project.id} />
        </Card>

        <Card lit>
          <CardHeader
            title="On this job"
            subtitle={`${project.uploads.length} ${project.uploads.length === 1 ? "file" : "files"}`}
          />
          {project.uploads.length === 0 ? (
            <EmptyState
              icon={<IconFileText size={20} />}
              title="No files yet"
              body="Photos from site, receipts, permits, or the customer's own signed contract."
            />
          ) : (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
              {project.uploads.map((upload) => (
                <li
                  key={upload.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                  data-testid="project-file"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {upload.name}
                      {upload.category && (
                        <>
                          {" "}
                          <Badge color={upload.category === "Signed contract" ? "#34d399" : "#94a3b8"}>
                            {upload.category}
                          </Badge>
                        </>
                      )}
                    </p>
                    <p className="faint num text-xs">
                      {upload.fileName} · {humanSize(upload.sizeBytes)} ·{" "}
                      {formatDate(upload.createdAt, timeZone)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a href={fileUrl(upload.publicToken)} className="btn btn-ghost btn-sm" download>
                      <IconDownload size={13} />
                      Download
                    </a>
                    <form action={deleteProjectFile}>
                      <input type="hidden" name="uploadId" value={upload.id} />
                      <button
                        type="submit"
                        aria-label={`Delete ${upload.name}`}
                        className="btn btn-ghost btn-sm !px-1.5"
                        data-testid="delete-project-file"
                      >
                        <IconTrash size={13} />
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
