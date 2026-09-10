import { formatDate } from "@/lib/format";
import { Badge, EmptyState } from "@/components/ui";
import { IconDownload, IconTrash, IconFileText } from "@/components/icons";
import { fileUrl } from "@/lib/uploads";
import { deleteDocument } from "./actions";

type Doc = {
  id: string;
  name: string;
  fileName: string;
  category: string | null;
  sizeBytes: number;
  expiresOn: Date | null;
  publicToken: string;
  createdAt: Date;
};

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The uploaded files on the Compliance or Marketing tile, newest first,
// with an expiry flag where one is set.
export function DocumentList({
  documents,
  timeZone,
  canEdit,
  emptyTitle,
  emptyBody,
}: {
  documents: Doc[];
  timeZone: string;
  canEdit: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (documents.length === 0) {
    return <EmptyState icon={<IconFileText size={20} />} title={emptyTitle} body={emptyBody} />;
  }

  const today = new Date();
  const soon = new Date(today.getTime() + 30 * 86_400_000);

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Expires</th>
            <th>Uploaded</th>
            <th>Size</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const expired = doc.expiresOn ? doc.expiresOn < today : false;
            const expiring = doc.expiresOn ? !expired && doc.expiresOn < soon : false;
            return (
              <tr key={doc.id}>
                <td>
                  <p className="font-medium">{doc.name}</p>
                  <p className="faint text-xs">{doc.fileName}</p>
                </td>
                <td>{doc.category ? <Badge>{doc.category}</Badge> : <span className="faint">—</span>}</td>
                <td className="text-xs">
                  {doc.expiresOn ? (
                    <span className={expired ? "text-[var(--danger)]" : expiring ? "text-[var(--warn)]" : "muted"}>
                      {formatDate(doc.expiresOn, "UTC")}
                      {expired ? " · expired" : expiring ? " · soon" : ""}
                    </span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
                <td className="faint text-xs">{formatDate(doc.createdAt, timeZone)}</td>
                <td className="faint num text-xs">{humanSize(doc.sizeBytes)}</td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <a href={fileUrl(doc.publicToken)} className="btn btn-ghost btn-sm" title="Download">
                      <IconDownload size={13} />
                    </a>
                    {canEdit && (
                      <form action={deleteDocument}>
                        <input type="hidden" name="uploadId" value={doc.id} />
                        <button type="submit" className="btn btn-icon-danger btn-sm" title="Delete" aria-label={`Delete ${doc.name}`}>
                          <IconTrash size={13} />
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
