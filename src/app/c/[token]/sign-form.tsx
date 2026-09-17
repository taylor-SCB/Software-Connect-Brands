"use client";

import { useEffect } from "react";

export function SignForm({
  token,
  contactName,
}: {
  token: string;
  contactName: string;
}) {
  // This component is kept for backwards compatibility but is no longer used
  // The signing flow is now handled server-side through DocuSign
  useEffect(() => {
    // If this component renders, something went wrong - contracts should use DocuSign
    console.warn("SignForm should not be rendered - use DocuSign signing flow instead");
  }, []);

  return null;
}
