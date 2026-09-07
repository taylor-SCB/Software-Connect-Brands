import Link from "next/link";

export default function SignupSubmittedPage() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm text-center">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Request received</h1>
          <p className="muted mt-3 text-sm">
            Your workspace has been created and is waiting to be reviewed. We&apos;ll
            get in touch on the number you gave us once it&apos;s open.
          </p>
          <p className="faint mt-4 text-xs">
            You won&apos;t be able to log in until then.
          </p>
        </div>
        <p className="faint mt-5 text-xs">
          <Link href="/login" className="link">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}
