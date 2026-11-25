import { sessionState } from "@/lib/session";

// The open tab's check (SessionWatch, Nov 25, 2026): is this browser still
// let in? Read from the database each time, so removing someone or pausing
// a workspace reaches a tab nobody is clicking in.
export async function GET() {
  const state = await sessionState();
  const body =
    state.kind === "ok"
      ? { ok: true as const, userId: state.user.id }
      : { ok: false as const, reason: state.kind === "blocked" ? state.reason : null };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
