import Link from "next/link";
import { IconBox, IconLayers } from "@/components/icons";

// Products | Ratesheets switch shown at the top of both pages, so the
// sub-module is one tap away without leaving the Products section.
export function ProductsSubnav({ current }: { current: "products" | "ratesheets" }) {
  const tabs = [
    { key: "products", href: "/dashboard/products", label: "Products", Icon: IconBox },
    { key: "ratesheets", href: "/dashboard/products/ratesheets", label: "Ratesheets", Icon: IconLayers },
  ] as const;

  return (
    <div className="mb-4 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 w-fit">
      {tabs.map(({ key, href, label, Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`nav-item !py-1.5 text-[0.8rem] ${active ? "nav-item-active" : ""}`}
          >
            <Icon size={14} className={active ? "" : "opacity-70"} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
