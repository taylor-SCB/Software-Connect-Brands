import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { fileUrl } from "@/lib/uploads";
import { isEmailConfigured } from "@/lib/email";
import { PageHeader, Card, CardHeader, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { IconFileText, IconDownload, IconTrash, IconPower, IconLink } from "@/components/icons";
import { CopyLink, PublicLinkField } from "@/components/copy-link";
import { MediaUploader } from "@/components/media-uploader";
import { PhotoGrid } from "@/components/photo-grid";
import { isMediaMime, jobAccounts } from "@/lib/job-photos";
import { getPhotoTags } from "@/lib/photo-tags";
import { ProjectTabs } from "../project-tabs";
import { ProjectFileForm } from "./project-file-form";
import { GrantAccessButton } from "./grant-access";
import { NewFolderForm } from "./new-folder-form";
import { deleteProjectFile } from "../../actions";
import { makeCrewLink, setGrantRole, turnOffCrewLink, turnOffGrant } from "../../photo-actions";

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Everything that belongs to the job but is not a number: photos from
// site, receipts, permits, and the other party's own contract when
// theirs was the paper that got signed.
//
// Photos and videos (Oct 17, 2026; reworked Oct 21, 2026) sit at the top:
// the job's main folder and its mini folders across a bar, a grid of
// tagged tiles for the folder open (?folder=), the crew photo link, and
// Grant Access for whoever outside the company may see that folder.
export default async function ProjectFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ folder?: string }>;
}) {
  const { organizationId, role } = await requireSession();
  const canGrant = role === "OWNER" || role === "ADMIN";
  const { id } = await params;
  const { folder: folderParam } = await searchParams;
  const timeZone = await getTimeZone();

  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      customerName: true,
      photoFolders: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
      photoLinks: {
        where: { kind: "CREW", active: true },
        take: 1,
        select: { id: true, token: true },
      },
    },
  });
  if (!project) notFound();

  const folder = project.photoFolders.find((each) => each.id === folderParam) ?? null;
  const folderId = folder?.id ?? null;
  const base = `/dashboard/projects/${project.id}/files`;

  const [uploads, counts, tags, grants, accounts] = await Promise.all([
    prisma.upload.findMany({
      where: { projectId: project.id, organizationId, kind: "PROJECT_FILE" },
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
        photoFolderId: true,
        uploadedByName: true,
        uploadedBy: { select: { name: true } },
        photoGrant: { select: { name: true } },
        tags: { select: { tagId: true } },
      },
    }),
    prisma.upload.groupBy({
      by: ["photoFolderId"],
      where: { projectId: project.id, organizationId, kind: "PROJECT_FILE", storageKey: { not: null } },
      _count: true,
    }),
    getPhotoTags(organizationId),
    prisma.photoGrant.findMany({
      where: { projectId: project.id, organizationId, folderId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, email: true, role: true, token: true, active: true, createdAt: true, revokedAt: true, lastUsedAt: true, emailedAt: true },
    }),
    canGrant ? jobAccounts(organizationId, project.id) : Promise.resolve([]),
  ]);

  // Photos kept in the database before Oct 17 have no folder and stay in
  // the main one; documents are listed further down.
  const media = uploads.filter((upload) => isMediaMime(upload.mimeType) && upload.photoFolderId === folderId);
  const documents = uploads.filter((upload) => !isMediaMime(upload.mimeType));
  const countIn = (id: string | null) => counts.find((row) => row.photoFolderId === id)?._count ?? 0;
  const crewLink = project.photoLinks[0];
  const folderName = folder ? folder.name : "Main folder";

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
          <CardHeader title="Photos & videos" subtitle="Everything sent to this job, tagged by what it is and where it was taken." />
          <div className="space-y-5 p-5">
            <nav className="flex flex-wrap items-center gap-1.5" aria-label="Photo folders" data-testid="folder-bar">
              <Link href={base} className={`btn btn-sm ${folderId === null ? "btn-primary" : "btn-ghost"}`} data-testid="folder-tab" data-name="Main folder">
                Main folder · {countIn(null)}
              </Link>
              {project.photoFolders.map((each) => (
                <Link
                  key={each.id}
                  href={`${base}?folder=${each.id}`}
                  className={`btn btn-sm ${folderId === each.id ? "btn-primary" : "btn-ghost"}`}
                  data-testid="folder-tab"
                  data-name={each.name}
                >
                  {each.name} · {countIn(each.id)}
                </Link>
              ))}
              <NewFolderForm projectId={project.id} />
            </nav>

            <div className="max-w-xl">
              <MediaUploader key={folderId ?? "main"} access={{ projectId: project.id }} folderId={folderId} tags={tags} />
            </div>

            <PhotoGrid
              key={folderId ?? "main"}
              access={{ projectId: project.id }}
              tags={tags}
              canTag
              staff={{ projectId: project.id, folderId, folders: project.photoFolders }}
              items={media.map((upload) => ({
                id: upload.id,
                name: upload.name,
                fileName: upload.fileName,
                mimeType: upload.mimeType,
                src: fileUrl(upload.publicToken),
                sentBy: upload.uploadedByName
                  ? `${upload.uploadedByName} · crew link`
                  : upload.photoGrant
                    ? `${upload.photoGrant.name} · shared link`
                    : (upload.uploadedBy?.name ?? null),
                sentOn: formatDate(upload.createdAt, timeZone),
                tagIds: upload.tags.map((tag) => tag.tagId),
              }))}
            />
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card lit>
            <CardHeader
              title={`Who can see the ${folderName}`}
              subtitle="Your own team sees everything. People outside the company see only the folders you grant them."
            />
            <div className="space-y-4 p-5" data-testid="grants-card">
              {canGrant ? (
                <GrantAccessButton
                  projectId={project.id}
                  folderId={folderId}
                  folderName={folderName}
                  accounts={accounts}
                  emailOn={isEmailConfigured()}
                />
              ) : (
                <p className="faint text-xs">Only an owner or admin can grant access to a job&apos;s photos.</p>
              )}
              {grants.length === 0 ? (
                <p className="faint text-xs">Nobody outside the company has access to this folder.</p>
              ) : (
                <ul className="space-y-3">
                  {grants.map((grant) => (
                    <li key={grant.id} className="space-y-1" data-testid="grant-row" data-name={grant.name} data-active={grant.active} data-role={grant.role}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {grant.name}{" "}
                          <Badge color={grant.role === "EDIT" ? "#34d399" : "#94a3b8"}>{grant.role === "EDIT" ? "Editor" : "View only"}</Badge>{" "}
                          {!grant.active && <Badge color="#94a3b8">Turned off</Badge>}
                        </p>
                        {grant.active && canGrant && (
                          <div className="flex flex-wrap items-center gap-1">
                            <CopyLink path={`/p/${grant.token}`} />
                            <form action={setGrantRole}>
                              <input type="hidden" name="grantId" value={grant.id} />
                              <input type="hidden" name="role" value={grant.role === "EDIT" ? "VIEW" : "EDIT"} />
                              <button type="submit" className="btn btn-ghost btn-sm" data-testid="grant-switch-role">
                                {grant.role === "EDIT" ? "Make view only" : "Make editor"}
                              </button>
                            </form>
                            <form action={turnOffGrant}>
                              <input type="hidden" name="grantId" value={grant.id} />
                              <button type="submit" className="btn btn-ghost btn-sm" data-testid="grant-off">
                                <IconPower size={13} />
                                Turn off
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                      <p className="faint text-xs">
                        {grant.email ?? "No email"} · granted {formatDate(grant.createdAt, timeZone)}
                        {grant.emailedAt && " · emailed"}
                        {grant.lastUsedAt && ` · last opened ${formatDate(grant.lastUsedAt, timeZone)}`}
                        {grant.revokedAt && ` · turned off ${formatDate(grant.revokedAt, timeZone)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card lit>
            <CardHeader
              title="Crew photo link"
              subtitle="Text this to your installers. They send photos and videos to the main folder and can tag them, but can't see anything."
            />
            <div className="space-y-3 p-5" data-testid="crew-link-card">
              {crewLink ? (
                <>
                  <PublicLinkField path={`/p/${crewLink.token}`} />
                  <div className="flex flex-wrap gap-2">
                    <form action={turnOffCrewLink}>
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
