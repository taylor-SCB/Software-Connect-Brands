import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { cleanPairs } from "@/lib/photo-report";

export const metadata: Metadata = {
  title: "Job photos",
  robots: { index: false, follow: false },
};

// The customer's before-and-after photo report (Release C, Nov 12, 2026):
// public, no login, no data-theme (like /q), in the workspace's own
// colours. Only a report its workspace has shared opens; turned off, it
// says so in plain words. Its photos come through /jr/<token>/photo/<id>,
// which serves only the photos in this report.
export default async function PhotoReportPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report =
    token && token.length >= 20
      ? await prisma.photoReport.findUnique({
          where: { token },
          select: {
            shared: true,
            summary: true,
            pairs: true,
            updatedAt: true,
            projectId: true,
            organizationId: true,
            project: { select: { name: true, customerName: true, siteAddress: true } },
            organization: { select: { name: true, logoUrl: true, primaryColor: true, timeZone: true, status: true } },
          },
        })
      : null;
  const organization = report?.organization ?? null;

  if (!report || !report.shared || report.organization.status !== "ACTIVE") {
    return (
      <Shell organization={organization} title="This report isn't shared right now">
        <div className="card p-8 text-center">
          <p className="text-sm">Ask {organization?.name ?? "whoever sent it"} for a new link.</p>
        </div>
      </Shell>
    );
  }

  const photos = await prisma.upload.findMany({
    where: { organizationId: report.organizationId, projectId: report.projectId, kind: "PROJECT_FILE" },
    select: { id: true, name: true },
  });
  const names = new Map(photos.map((photo) => [photo.id, photo.name]));
  const pairs = cleanPairs(report.pairs, new Set(names.keys()));
  const src = (id: string) => `/jr/${token}/photo/${id}`;

  return (
    <Shell organization={organization} title={report.project.name}>
      <div className="card card-lit space-y-2 p-5">
        <p className="muted text-sm">
          {report.project.customerName}
          {report.project.siteAddress ? ` · ${report.project.siteAddress}` : ""} · {formatDate(report.updatedAt, report.organization.timeZone)}
        </p>
        {report.summary && (
          <p className="whitespace-pre-line text-sm" data-testid="report-public-summary">
            {report.summary}
          </p>
        )}
      </div>
      <ul className="mt-5 space-y-5">
        {pairs.map((pair, index) => (
          <li key={index} className="card card-lit space-y-3 p-4" data-testid="report-public-pair">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["beforeId", "afterId"] as const).map((side) => (
                <figure key={side} className="min-w-0 space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src(pair[side])} alt={`${side === "beforeId" ? "Before" : "After"}: ${names.get(pair[side]) ?? ""}`} className="aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" />
                  <figcaption className="eyebrow">{side === "beforeId" ? "Before" : "After"}</figcaption>
                </figure>
              ))}
            </div>
            {pair.line && (
              <p className="text-sm" data-testid="report-public-line">
                {pair.line}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Shell({
  organization,
  title,
  children,
}: {
  organization: { name: string; logoUrl: string | null; primaryColor: string } | null;
  title: string;
  children: React.ReactNode;
}) {
  const brand = organization?.primaryColor;
  return (
    <div className="doc-page relative z-10 px-4 py-8 sm:px-6" style={brand ? { ["--brand" as string]: brand } : undefined}>
      <div className="mx-auto max-w-4xl">
        <header className="card card-lit mb-5 flex items-center gap-3 p-5">
          {organization?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
          ) : organization ? (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold" style={{ background: brand, color: "#fff" }}>
              {organization.name.charAt(0)}
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="eyebrow">{organization ? `Photos from ${organization.name}` : "Job photos"}</p>
            <h1 className="truncate text-xl font-semibold" data-testid="report-public-title">
              {title}
            </h1>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
