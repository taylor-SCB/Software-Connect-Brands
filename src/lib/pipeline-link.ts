// The address of one tile on the Pipeline (integration, Nov 11, 2026):
// /dashboard/deals?open=<opportunityId> opens its panel, and shows the
// tile even when Mine or a filter would hide it. With no tile, the board.
// Link to one opportunity this way, never ?q=<name>. Pure: the sheets'
// "Pipeline →" links and the server's reports both use it.
export function pipelineHref(opportunityId: string | null | undefined) {
  return opportunityId ? `/dashboard/deals?open=${encodeURIComponent(opportunityId)}` : "/dashboard/deals";
}
