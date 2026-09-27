"use server";

import { redirect } from "next/navigation";
import { unsubscribe } from "@/lib/unsubscribe";

export async function confirmUnsubscribe(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await unsubscribe(token);
  redirect(`/u/${encodeURIComponent(token)}`);
}
