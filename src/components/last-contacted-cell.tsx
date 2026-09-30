import { formatDate } from "@/lib/format";
import type { LastContact } from "@/lib/last-contacted";

// The first column on the Contacts and Companies lists: who last reached
// out, and when, in the workspace's own time zone.
export function LastContactedCell({ last, timeZone }: { last?: LastContact; timeZone: string | null }) {
  if (!last) return <span className="faint text-xs">Not yet</span>;
  return (
    <div className="whitespace-nowrap text-xs" data-testid="last-contacted">
      <p className="font-medium">{last.by}</p>
      <p className="faint num">{formatDate(last.at, timeZone)}</p>
    </div>
  );
}
