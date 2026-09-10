import Link from "next/link";
import {
  IconBuilding,
  IconSparkles,
  IconUsers,
  IconCheck,
  IconLayers,
} from "@/components/icons";

export type CompanyTile = "general" | "branding" | "users" | "compliance" | "marketing";

// The five tiles across the top of Company Information. Branding keeps
// the address the settings page has always had; the others sit under it.
export const COMPANY_TILES: { key: CompanyTile; href: string; label: string; blurb: string; Icon: typeof IconBuilding }[] = [
  { key: "general", href: "/dashboard/settings/general", label: "General", blurb: "Address, website, about us", Icon: IconBuilding },
  { key: "branding", href: "/dashboard/settings", label: "Branding", blurb: "Name, logo, colors, time zone", Icon: IconSparkles },
  { key: "users", href: "/dashboard/settings/users", label: "Company Users", blurb: "Who is on the account", Icon: IconUsers },
  { key: "compliance", href: "/dashboard/settings/compliance", label: "Compliance", blurb: "W-9, COI, licenses", Icon: IconCheck },
  { key: "marketing", href: "/dashboard/settings/marketing", label: "Marketing", blurb: "Brochures and materials", Icon: IconLayers },
];

export function CompanyTiles({ current }: { current: CompanyTile }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="tablist" aria-label="Company Information">
      {COMPANY_TILES.map(({ key, href, label, blurb, Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={href}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            className={`card card-hover flex items-start gap-3 p-3 ${active ? "card-lit" : ""}`}
            style={
              active
                ? {
                    borderColor: "color-mix(in srgb, var(--brand) 55%, transparent)",
                    background: "color-mix(in srgb, var(--brand) 10%, transparent)",
                  }
                : undefined
            }
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "color-mix(in srgb, var(--brand) 14%, transparent)",
                color: "var(--brand)",
              }}
            >
              <Icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{label}</span>
              <span className="faint block truncate text-[0.7rem]">{blurb}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
