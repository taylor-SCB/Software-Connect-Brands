import { formatDate } from "@/lib/format";
import { fileUrl } from "@/lib/uploads";
import { PHOTO_CATEGORIES } from "@/lib/constants";
import { IconDownload, IconTrash } from "@/components/icons";

export type MediaItem = {
  id: string;
  name: string;
  fileName: string;
  category: string | null;
  mimeType: string;
  publicToken: string;
  createdAt: Date;
  sentBy: string | null;
};

// Browsers other than Safari can't draw an iPhone's HEIC, so those show
// as a tile that downloads rather than a broken picture.
function drawable(mimeType: string) {
  return mimeType.startsWith("image/") && !/hei[cf]/.test(mimeType);
}

// A job's photos and videos, grouped Site walk / Finished install / Photo
// so the before and the after read as two piles. The same grid serves
// the Files tab (with delete) and a shared look-only link (`viewToken`
// rides on every address so /files/<token> knows who is asking).
export function MediaGallery({
  items,
  timeZone,
  viewToken,
  deleteAction,
}: {
  items: MediaItem[];
  timeZone: string;
  viewToken?: string;
  deleteAction?: (formData: FormData) => Promise<void>;
}) {
  const order: string[] = [...PHOTO_CATEGORIES];
  const groups = new Map<string, MediaItem[]>();
  for (const item of items) {
    const key = item.category && order.includes(item.category) ? item.category : "Photo";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const src = (item: MediaItem) => `${fileUrl(item.publicToken)}${viewToken ? `?v=${encodeURIComponent(viewToken)}` : ""}`;

  return (
    <div className="space-y-6">
      {order
        .filter((category) => groups.has(category))
        .map((category) => (
          <section key={category} data-testid="media-group" data-category={category}>
            <h3 className="eyebrow mb-2">
              {category} · {groups.get(category)!.length}
            </h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {groups.get(category)!.map((item) => (
                <li key={item.id} className="overflow-hidden rounded-lg border border-[var(--border)]" data-testid="media-item">
                  {item.mimeType.startsWith("video/") ? (
                    <video src={src(item)} controls preload="metadata" playsInline className="aspect-square w-full bg-black object-cover" />
                  ) : drawable(item.mimeType) ? (
                    <a href={src(item)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src(item)} alt={item.name} loading="lazy" className="aspect-square w-full object-cover" />
                    </a>
                  ) : (
                    <a href={src(item)} className="faint flex aspect-square w-full items-center justify-center text-xs">
                      <IconDownload size={16} /> {item.fileName}
                    </a>
                  )}
                  <div className="flex items-start justify-between gap-1 px-2 py-1.5">
                    <p className="faint min-w-0 text-[0.7rem] leading-snug">
                      {item.sentBy && <span className="block truncate">{item.sentBy}</span>}
                      {formatDate(item.createdAt, timeZone)}
                    </p>
                    {deleteAction && (
                      <form action={deleteAction}>
                        <input type="hidden" name="uploadId" value={item.id} />
                        <button
                          type="submit"
                          aria-label={`Delete ${item.name}`}
                          className="btn btn-ghost btn-sm !px-1.5"
                          data-testid="delete-media"
                        >
                          <IconTrash size={12} />
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
