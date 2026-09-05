"use server";

import { signOut as authSignOut } from "@/lib/auth";

export async function logout() {
  await authSignOut({ redirectTo: "/login" });
}
