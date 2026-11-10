import { cookieTheme } from "@/lib/theme";
import { LookSwitch } from "@/components/look-switch";

// The look on the signed-out pages (login, signup, password reset). There
// is no person yet, so the pick is this browser's cookie. Fixed in the
// corner so it moves nothing on the page; its data-theme is what turns the
// page Light (globals.css), in the server's HTML, so nothing flashes.
export async function SignedOutLook() {
  const theme = await cookieTheme();
  return (
    <div data-theme={theme} className="fixed right-4 top-4 z-20">
      <LookSwitch key={theme} theme={theme} className="inline-flex" />
    </div>
  );
}
