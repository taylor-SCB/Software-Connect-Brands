import { SignedOutLook } from "@/components/signed-out-look";

// The signup page is a client component, so the look switch (which reads
// this browser's cookie on the server) is rendered here, beside it, for
// /signup and /signup/submitted alike. Fixed in the corner; it moves
// nothing on the page.
export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedOutLook />
      {children}
    </>
  );
}
