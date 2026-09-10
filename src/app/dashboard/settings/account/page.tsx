import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { AccountForm, PasswordForm } from "./form";

export default async function MyAccountPage() {
  const session = await requireSession();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: {
      name: true,
      email: true,
      title: true,
      phone: true,
      avatarUrl: true,
      receiveInAppMessages: true,
      role: true,
    },
  });

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="My Account"
        subtitle="Who you are on this workspace. Your name and title print where you sign."
      />

      <div className="space-y-5">
        <Card lit>
          <CardHeader
            title="Profile"
            subtitle={`${user.role.charAt(0) + user.role.slice(1).toLowerCase()} on this workspace`}
          />
          <AccountForm user={user} />
        </Card>

        <Card lit>
          <CardHeader
            title="Password"
            subtitle="There is no password reset by email yet, so this is the place to change it."
          />
          <PasswordForm />
        </Card>
      </div>
    </div>
  );
}
