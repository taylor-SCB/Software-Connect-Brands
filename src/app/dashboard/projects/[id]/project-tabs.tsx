import Link from "next/link";

export type ProjectTab = "budget" | "money" | "crew" | "files";

const TABS: { key: ProjectTab; segment: string; label: string }[] = [
  { key: "budget", segment: "", label: "Budget" },
  { key: "money", segment: "/money", label: "Money" },
  { key: "crew", segment: "/crew", label: "Crew & time" },
  { key: "files", segment: "/files", label: "Files" },
];

// The strip across a job. Kept to plain words a contractor uses about a
// job, not the app's own vocabulary.
export function ProjectTabs({ projectId, current }: { projectId: string; current: ProjectTab }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="This job">
      {TABS.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={`/dashboard/projects/${projectId}${tab.segment}`}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
            data-testid={`tab-${tab.key}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
