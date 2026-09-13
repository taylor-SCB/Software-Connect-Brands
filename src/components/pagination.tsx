import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";

// "Showing 51–100 of 12,340" with Previous / Next and a few page numbers.
// Plain links, so it renders from a server component and Back works.
export function Pagination({
  total,
  from,
  to,
  page,
  pages,
  hrefFor,
  noun,
}: {
  total: number;
  from: number;
  to: number;
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  noun: string;
}) {
  const numbers = pageNumbers(page, pages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
      <p className="faint text-xs" data-testid="page-summary">
        {total === 0
          ? `No ${noun}`
          : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
      </p>
      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pages">
          <PageLink href={hrefFor(page - 1)} disabled={page <= 1} label="Previous page">
            <IconChevronLeft size={13} />
          </PageLink>
          {numbers.map((n, index) =>
            n === null ? (
              <span key={`gap-${index}`} className="faint px-1 text-xs">
                …
              </span>
            ) : (
              <PageLink key={n} href={hrefFor(n)} current={n === page} label={`Page ${n}`}>
                {n}
              </PageLink>
            ),
          )}
          <PageLink href={hrefFor(page + 1)} disabled={page >= pages} label="Next page">
            <IconChevronRight size={13} />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled = false,
  current = false,
  label,
  children,
}: {
  href: string;
  disabled?: boolean;
  current?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const className = `btn btn-sm min-w-[2rem] justify-center ${current ? "btn-primary" : "btn-ghost"} ${
    disabled ? "pointer-events-none opacity-40" : ""
  }`;
  if (disabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}

// 1 … 4 5 [6] 7 8 … 40
function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const around = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => around.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => around.add(n));
  const sorted = Array.from(around).filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}
