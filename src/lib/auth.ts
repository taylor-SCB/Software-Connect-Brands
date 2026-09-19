import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { findLoginUser } from "@/lib/login-user";
import { authConfig } from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        // Matched without regard to case: see findLoginUser. An exact
        // lookup here locked people out of their own workspace when a
        // phone capitalised the address for them.
        const user = await findLoginUser(email);
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Right password, wrong workspace state. Returning null rather
        // than throwing: a custom error thrown out of authorize does not
        // survive NextAuth's serialization, and the caller gets a crashed
        // page instead of a login form. The login action works out which
        // of the two happened and words the message accordingly.
        if (user.organization.status !== "ACTIVE") return null;

        // Drives the "last login" column in the admin list — the quickest
        // read on whether a workspace is actually being used.
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          organizationId: user.organizationId,
          role: user.role,
          isSuperAdmin: user.isSuperAdmin,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt: async ({ token, user }) => {
      if (user) {
        token.organizationId = user.organizationId;
        token.role = user.role;
        token.isSuperAdmin = user.isSuperAdmin;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.organizationId = token.organizationId as string;
        session.user.role = token.role as string;
        session.user.isSuperAdmin = token.isSuperAdmin === true;
      }
      return session;
    },
  },
});
