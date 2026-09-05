import type { NextAuthConfig } from "next-auth";

// Edge-safe subset of the auth config. Middleware runs on the Edge
// runtime, which can't load bcrypt/Prisma, so the Credentials provider
// (defined in auth.ts) is intentionally left out here.
export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isDashboard = request.nextUrl.pathname.startsWith("/dashboard");
      if (isDashboard) return isLoggedIn;
      return true;
    },
  },
} satisfies NextAuthConfig;
