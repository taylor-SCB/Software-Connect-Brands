import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { fileUrl } from "@/lib/uploads";
import { PageHeader, Card, CardHeader, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconFileText, IconDownload, IconTrash, IconPower, IconLink } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { MediaGallery } from "@/components/media-gallery";
import { MediaUploader } from "@/components/media-uploader";
import { isMediaMime } from "@/lib/job-photos";
import { ProjectTabs } from "../project-tabs";
import { ProjectFileForm } from "./project-file-form";
import { ViewLinkForm } from "./view-link-form";
import { deleteProjectFile } from "../../actions";
import { finishStaffUpload, makeCrewLink, startStaffUpload, turnOffPhotoLink } from "../../photo-actions";

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Everything that belongs to the job but is not a number: photos from
// site, receipts, permits, and the other party's own contract when
// theirs was the paper that got signed.
//
// Photos and videos (Oct 17, 2026) sit in their own grid at the top, with
// the crew photo link an installer sends them through and the look-only
// links the job's photos are shared with.
export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, role } = await requireSession();
  const canShare = role === "OWNER" || role === "ADMIN";
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
          mimeType: true,
          publicToken: true,
          createdAt: true,
          uploadedByName: true,
          uploadedBy: { select: { name: true } },
        },
      },
      photoLinks: {
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, token: true, label: true, active: true, createdAt: true, revokedAt: true, lastUsedAt: true },
      },
    },
  });
  if (!project) notFound();

  const media = project.uploads.filter((upload) => isMediaMime(upload.mimeType));
  const documents = project.uploads.filter((upload) => !isMediaMime(upload.mimeType));
  const crewLink = project.photoLinks.find((link) => link.kind === "CREW" && link.active);
  const viewLinks = project.photoLinks.filter((link) => link.kind === "VIEW");

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
            title="Photos & videos"
            subtitle={`${media.length} on this job. Site walks and finished installs, from the office or the crew.`}
          />
          <div className="space-y-6 p-5">
            <div className="max-w-xl">
              <MediaUploader
                start={startStaffUpload.bind(null, project.id)}
                finish={finishStaffUpload.bind(null, project.id)}
              />
            </div>
            {media.length > 0 && (
              <MediaGallery
                timeZone={timeZone}
                deleteAction={deleteProjectFile}
                items={media.map((upload) => ({
                  ...upload,
                  sentBy: upload.uploadedByName
                    ? `${upload.uploadedByName} · crew link`
                    : (upload.uploadedBy?.name ?? null),
                }))}
              />
            )}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card lit>
            <CardHeader
              title="Crew photo link"
              subtitle="Text this to your installers. They can send photos and videos to this job, and can't see anything."
            />
            <div className="space-y-3 p-5" data-testid="crew-link-card">
              {crewLink ? (
                <>
                  <PublicLinkField path={`/p/${crewLink.token}`} />
                  <div className="flex flex-wrap gap-2">
                    <form action={turnOffPhotoLink}>
                      <input type="hidden" name="linkId" value={crewLink.id} />
                      <button type="submit" className="btn btn-ghost btn-sm" data-testid="crew-link-off">
                        <IconPower size={13} />
                        Turn off
                      </button>
                    </form>
                    <form action={makeCrewLink}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <button type="submit" className="btn btn-ghost btn-sm" data-testid="crew-link-new">
                        <IconLink size={13} />
                        New link
                      </button>
                    </form>
                  </div>
                  <p className="faint text-xs">New link turns this one off, for when someone leaves the crew.</p>
                </>
              ) : (
                <form action={makeCrewLink}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <button type="submit" className="btn btn-primary btn-sm" data-testid="crew-link-make">
                    <IconLink size={13} />
                    Make crew photo link
                  </button>
                </form>
              )}
            </div>
          </Card>

          <Card lit>
            <CardHeader
              title="Shared with"
              subtitle="A look-only gallery of this job's photos and videos, for anyone in or outside the company."
            />
            <div className="space-y-4 p-5" data-testid="view-links-card">
              {canShare ? (
                <ViewLinkForm projectId={project.id} />
              ) : (
                <p className="faint text-xs">Only an owner or admin can share a job&apos;s photos.</p>
              )}
              {viewLinks.length > 0 && (
                <ul className="space-y-3">
                  {viewLinks.map((link) => (
                    <li key={link.id} className="space-y-1.5" data-testid="view-link" data-active={link.active}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {link.label}{" "}
                          {!link.active && <Badge color="#94a3b8">Turned off</Badge>}
                        </p>
                        {link.active && canShare && (
                          <form action={turnOffPhotoLink}>
                            <input type="hidden" name="linkId" value={link.id} />
                            <button type="submit" className="btn btn-ghost btn-sm" data-testid="view-link-off">
                              <IconPower size={13} />
                              Turn off
                            </button>
                          </form>
                        )}
                      </div>
                      {link.active && <PublicLinkField path={`/p/${link.token}`} />}
                      <p className="faint text-xs">
                        Made {formatDate(link.createdAt, timeZone)}
                        {link.lastUsedAt && ` · last opened ${formatDate(link.lastUsedAt, timeZone)}`}
                        {link.revokedAt && ` · turned off ${formatDate(link.revokedAt, timeZone)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

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
            subtitle={`${documents.length} ${documents.length === 1 ? "file" : "files"}`}
          />
          {documents.length === 0 ? (
            <EmptyState
              icon={<IconFileText size={20} />}
              title="No files yet"
              body="Receipts, permits, plans, or the customer's own signed contract."
            />
          ) : (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
              {documents.map((upload) => (
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
