import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { IconSparkles } from "@/components/icons";

const FEATURES = [
  {
    title: "Contacts & activity",
    body: "Company, contact, phone, site — with note and touchpoint counters on every row.",
  },
  {
    title: "Quotes that close",
    body: "Line items tagged by labor, materials and more, totalled by category automatically.",
  },
  {
    title: "Contracts & e-sign",
    body: "Service agreements and change orders from your own templates, signed in the browser.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-16">
      <div className="fade-up w-full max-w-3xl text-center">
        <span className="badge mx-auto mb-6 border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)]">
          <IconSparkles size={13} />
          White-label CRM for service businesses
        </span>

        <h1 className="page-title text-balance !text-4xl sm:!text-6xl">
          Run the whole job.
          <br />
          Under your own name.
        </h1>

        <p className="muted mx-auto mt-5 max-w-xl text-pretty text-sm leading-relaxed sm:text-base">
          Contacts, pipeline, products, quotes and signed contracts — one
          workspace per business, branded with their logo and colors.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="btn btn-primary">
            Create your workspace
          </Link>
          <Link href="/login" className="btn btn-ghost">
            Log in
          </Link>
        </div>

        <div className="mt-14 grid gap-3 text-left sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card card-lit card-hover p-4">
              <p className="text-sm font-semibold">{feature.title}</p>
              <p className="faint mt-1.5 text-xs leading-relaxed">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
