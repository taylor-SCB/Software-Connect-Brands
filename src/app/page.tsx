import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">
        A CRM your business can put its own name on
      </h1>
      <p className="max-w-md text-gray-600">
        Track leads, deals, and customer notes in one place — branded with
        your company&apos;s name and colors.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}
