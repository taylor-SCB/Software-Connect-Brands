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
      // /admin is gated again in requireSuperAdmin — this only turns away
      // anonymous visitors early. The Edge runtime can't reach Prisma, so
      // the operator check itself can't happen here.
      const path = request.nextUrl.pathname;
      if (path.startsWith("/dashboard") || path.startsWith("/admin")) {
        return isLoggedIn;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
