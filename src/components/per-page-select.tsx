"use client";

import { useRouter } from "next/navigation";

// "Per page" in a list's footer, beside the page numbers (round 2, Nov 11,
// 2026: moved down from the filter bar, as the plan's hiddenNotRemoved
// says). Each choice is the list's own address with that page size, worked
// out on the server, so picking one is a plain navigation.
export function PerPageSelect({ value, options }: { value: number; options: { size: number; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="faint">Per page</span>
      <select
        value={value}
        onChange={(event) => {
          const picked = options.find((option) => option.size === Number(event.target.value));
          if (picked) router.push(picked.href);
        }}
        aria-label="Rows per page"
        data-testid="per-page"
        className="select input-sm min-h-[44px] w-[4.75rem] py-1 pr-7 md:min-h-0"
      >
        {options.map((option) => (
          <option key={option.size} value={option.size}>
            {option.size}
          </option>
        ))}
      </select>
    </label>
  );
}
