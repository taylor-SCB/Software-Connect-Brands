import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    organizationId: string;
    role: string;
    isSuperAdmin: boolean;
  }

  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: string;
      isSuperAdmin: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    organizationId: string;
    role: string;
    isSuperAdmin: boolean;
  }
}
