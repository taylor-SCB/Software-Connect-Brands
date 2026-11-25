"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { sessionState } from "@/lib/session";

// Wipes the login cookie of a browser that is no longer let in and shows
// the login page with the reason. The reason is read from the database,
// never from the browser, and a browser still let in is sent back to the
// dashboard untouched, so nothing can use this to sign anybody out.
export async function endSession() {
  const state = await sessionState();
  if (state.kind === "ok") redirect("/dashboard");
  if (state.kind === "none") redirect("/login");
  await signOut({ redirectTo: `/login?status=${state.reason}` });
}
