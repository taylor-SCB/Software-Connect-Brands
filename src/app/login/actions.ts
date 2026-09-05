"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function login(_prevState: { error?: string }, formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return { error: undefined };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }
}
