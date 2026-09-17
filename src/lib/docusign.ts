// HelloSign API utilities for contract signing
// Documentation: https://www.hellosign.com/api/reference

const HELLOSIGN_API_URL = "https://api.hellosign.com/v3";

interface HelloSignResponse {
  signature_request?: {
    signature_request_id: string;
    status: string;
  };
  error?: {
    error_msg: string;
  };
}

// Send contract for signing via HelloSign
export async function sendContractForSigning(
  contractBody: string,
  contractTitle: string,
  recipientEmail: string,
  recipientName: string,
  returnUrl: string,
  apiKey: string,
): Promise<{ requestId: string; signingUrl: string }> {
  if (!apiKey) {
    throw new Error("HelloSign API key is required. Configure it in your workspace settings.");
  }

  // HelloSign requires a file, we'll use the HTML version of the contract
  const formData = new FormData();
  formData.append("title", contractTitle);
  formData.append("subject", `Please sign: ${contractTitle}`);
  formData.append("message", `Please review and sign the attached contract.`);

  // Add signer
  formData.append("signers[0][email_address]", recipientEmail);
  formData.append("signers[0][name]", recipientName);

  // Add contract as text (HelloSign will convert to PDF)
  // For now, we'll create a simple text file representation
  const blob = new Blob([contractBody], { type: "text/plain" });
  formData.append("file[0]", blob, `${contractTitle}.txt`);

  // Set return URL after signing
  formData.append("signing_redirect_url", returnUrl);

  const response = await fetch(`${HELLOSIGN_API_URL}/signature_request/send`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`HelloSign API error: ${error.error?.error_msg || "Unknown error"}`);
  }

  const data = (await response.json()) as HelloSignResponse;

  if (!data.signature_request) {
    throw new Error("Failed to create signature request with HelloSign");
  }

  return {
    requestId: data.signature_request.signature_request_id,
    signingUrl: `https://app.hellosign.com/sign/${data.signature_request.signature_request_id}`,
  };
}

// Get signature request status
export async function getSignatureStatus(requestId: string, apiKey: string): Promise<string> {
  const response = await fetch(`${HELLOSIGN_API_URL}/signature_request/${requestId}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to get signature request status from HelloSign");
  }

  const data = (await response.json()) as HelloSignResponse;
  return data.signature_request?.status || "unknown";
}

// Download signed PDF
export async function getSignedDocument(requestId: string, apiKey: string): Promise<Buffer> {
  const response = await fetch(`${HELLOSIGN_API_URL}/signature_request/files/${requestId}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to download signed document from HelloSign");
  }

  return Buffer.from(await response.arrayBuffer());
}
