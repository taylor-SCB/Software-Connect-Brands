import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { findPhotoLink, isMediaMime } from "@/lib/job-photos";
import { MediaGallery } from "@/components/media-gallery";
import { MediaUploader } from "@/components/media-uploader";
import { finishCrewUpload, startCrewUpload } from "./actions";

export const metadata: Metadata = {
  title: "Job photos",
  robots: { index: false, follow: false },
};

// Public, no login (Oct 17, 2026). A crew link is a phone screen for
// sending photos and videos to one job; a view link is a look-only
// gallery of that job's photos. Either one turned off, or its workspace
// paused, says so in plain words rather than a bare 404, because the
// person holding it is an installer in a driveway, not a snooper.
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

  if (link.kind === "CREW") {
    const sentHere = await prisma.upload.count({ where: { photoLinkId: link.id } });
    return (
      <Shell organization={organization} eyebrow={`Photos for ${organization.name}`} title={project.name}>
        <div className="card card-lit space-y-4 p-5">
          <p className="muted text-sm">
            {project.customerName} · PRJ-{project.number}. Photos and videos sent here go straight to the office.
          </p>
          <MediaUploader
            askName
            testId="crew"
            start={startCrewUpload.bind(null, token)}
            finish={finishCrewUpload.bind(null, token)}
          />
          {sentHere > 0 && (
            <p className="faint text-xs" data-testid="crew-sent-total">
              {sentHere} sent on this link so far.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  await prisma.projectPhotoLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  const uploads = await prisma.upload.findMany({
    where: { projectId: project.id, organizationId: link.organizationId, kind: "PROJECT_FILE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      fileName: true,
      category: true,
      mimeType: true,
      publicToken: true,
      createdAt: true,
    },
  });
  const media = uploads.filter((upload) => isMediaMime(upload.mimeType));

  return (
    <Shell organization={organization} eyebrow={`Shared by ${organization.name}`} title={project.name}>
      <p className="muted mb-4 text-sm">
        {project.customerName} · {media.length} {media.length === 1 ? "photo or video" : "photos and videos"}
      </p>
      {media.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="faint text-sm">Nothing here yet.</p>
        </div>
      ) : (
        <div className="card card-lit p-5">
          <MediaGallery
            timeZone={organization.timeZone}
            viewToken={token}
            items={media.map((upload) => ({ ...upload, sentBy: null }))}
          />
        </div>
      )}
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
