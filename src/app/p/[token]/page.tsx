import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { fileUrl } from "@/lib/uploads";
import { findPhotoLink, isMediaMime } from "@/lib/job-photos";
import { getPhotoTags } from "@/lib/photo-tags";
import { MediaUploader } from "@/components/media-uploader";
import { PhotoGrid } from "@/components/photo-grid";

export const metadata: Metadata = {
  title: "Job photos",
  robots: { index: false, follow: false },
};

// Public, no login. A crew link (Oct 17, 2026) is a phone screen for
// sending photos and videos to one job's main folder, tagged if the
// installer likes; it shows nothing. A person's grant (Oct 21, 2026) opens
// one folder of a job's photos with its tag filters: View only looks, an
// Editor also adds photos to that folder and changes tags, and nobody
// here deletes. Either one turned off, or its workspace paused, says so in
// plain words rather than a bare 404.
export default async function JobPhotosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await findPhotoLink(token);

  if (!link?.usable) {
    return (
      <Shell organization={link?.organization ?? null} eyebrow="Job photos" title="This link is turned off">
        <div className="card p-8 text-center">
          <p className="text-sm">Ask {link?.organization.name ?? "whoever sent it"} for a new one.</p>
        </div>
      </Shell>
    );
  }

  const { organization, project } = link;
  const tags = await getPhotoTags(link.organizationId);

  if (link.kind === "CREW") {
    const sentHere = await prisma.upload.count({ where: { photoLinkId: link.id } });
    return (
      <Shell organization={organization} eyebrow={`Photos for ${organization.name}`} title={project.name}>
        <div className="card card-lit space-y-4 p-5">
          <p className="muted text-sm">
            {project.customerName} · PRJ-{project.number}. Photos and videos sent here go straight to the office.
          </p>
          <MediaUploader askName testId="crew" access={{ token }} tags={tags} />
          {sentHere > 0 && (
            <p className="faint text-xs" data-testid="crew-sent-total">
              {sentHere} sent on this link so far.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  await prisma.photoGrant.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  const uploads = await prisma.upload.findMany({
    where: { projectId: project.id, organizationId: link.organizationId, kind: "PROJECT_FILE", photoFolderId: link.folder?.id ?? null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      fileName: true,
      mimeType: true,
      publicToken: true,
      createdAt: true,
      uploadedByName: true,
      uploadedBy: { select: { name: true } },
      photoGrant: { select: { name: true } },
      tags: { select: { tagId: true } },
    },
  });
  const media = uploads.filter((upload) => isMediaMime(upload.mimeType));
  const editor = link.role === "EDIT";
  const where = link.folder ? `${link.folder.name} · ${project.name}` : project.name;

  return (
    <Shell organization={organization} eyebrow={`Shared by ${organization.name}`} title={where}>
      <p className="muted mb-4 text-sm" data-testid="grant-intro">
        {project.customerName} · {media.length} {media.length === 1 ? "photo or video" : "photos and videos"} ·{" "}
        {editor ? "You can add photos and change tags." : "View only."}
      </p>
      <div className="space-y-5">
        {editor && (
          <div className="card card-lit max-w-xl p-5">
            <MediaUploader testId="editor" access={{ token }} tags={tags} />
          </div>
        )}
        <div className="card card-lit p-5">
          <PhotoGrid
            access={{ token }}
            tags={tags}
            canTag={editor}
            items={media.map((upload) => ({
              id: upload.id,
              name: upload.name,
              fileName: upload.fileName,
              mimeType: upload.mimeType,
              src: `${fileUrl(upload.publicToken)}?v=${encodeURIComponent(token)}`,
              sentBy: upload.uploadedByName ?? upload.photoGrant?.name ?? upload.uploadedBy?.name ?? organization.name,
              sentOn: formatDate(upload.createdAt, organization.timeZone),
              tagIds: upload.tags.map((tag) => tag.tagId),
            }))}
          />
        </div>
      </div>
    </Shell>
  );
}

function Shell({
  organization,
  eyebrow,
  title,
  children,
}: {
  organization: { name: string; logoUrl: string | null; primaryColor: string } | null;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  const brand = organization?.primaryColor;
  return (
    <div
      className="doc-page relative z-10 px-4 py-8 sm:px-6"
      style={brand ? { ["--brand" as string]: brand } : undefined}
    >
      <div className="mx-auto max-w-4xl">
        <header className="card card-lit mb-5 flex items-center gap-3 p-5">
          {organization?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
          ) : organization ? (
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
              style={{ background: brand, color: "#fff" }}
            >
              {organization.name.charAt(0)}
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="truncate text-xl font-semibold" data-testid="photos-title">{title}</h1>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
