// The Contacts and Companies lists' header (round 2, Nov 11, 2026). On a
// laptop it is PageHeader, line for line: the eyebrow, the title, the count
// and the buttons. On a phone the title and count are kept for screen
// readers only (the bottom bar already says which list this is, the
// Filters sheet and the footer say how many) and the buttons — ⋯ and + —
// sit at the right of the search box, which is the first thing on the
// page, so the first card starts about 180px down. The buttons are drawn
// once, so their dialogs are never doubled.
//
// The page around it must be `relative` (the buttons are placed against
// it on a phone). No z-index: a dialog the buttons open keeps its own.
export function ListHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="max-md:absolute max-md:right-0 max-md:top-0 md:mb-7 md:flex md:flex-wrap md:items-end md:justify-between md:gap-4" data-testid="list-header">
      <div className="max-md:sr-only md:flex md:items-center md:gap-4">
        <div>
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 md:flex-wrap">{actions}</div>}
    </div>
  );
}
