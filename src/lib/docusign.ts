import jwt from "jsonwebtoken";
import { ApiClient, EnvelopesApi, EnvelopeDefinition, Document, Signer, SignHere, Tabs } from "docusign-esign";

const DOCUSIGN_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
const DOCUSIGN_PRIVATE_KEY = process.env.DOCUSIGN_PRIVATE_KEY;
const DOCUSIGN_ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const DOCUSIGN_ENVIRONMENT = process.env.DOCUSIGN_ENVIRONMENT || "https://demo.docusign.net";

if (!DOCUSIGN_INTEGRATION_KEY || !DOCUSIGN_PRIVATE_KEY || !DOCUSIGN_ACCOUNT_ID) {
  throw new Error("Missing required DocuSign environment variables: DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_PRIVATE_KEY, DOCUSIGN_ACCOUNT_ID");
}

// Cache for access token with expiry
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

// Generate JWT token for DocuSign OAuth
function generateJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour

  const payload = {
    iss: DOCUSIGN_INTEGRATION_KEY,
    sub: DOCUSIGN_ACCOUNT_ID,
    aud: DOCUSIGN_ENVIRONMENT,
    iat: now,
    exp,
  };

  return jwt.sign(payload, DOCUSIGN_PRIVATE_KEY, {
    algorithm: "RS256",
    header: { typ: "JWT" },
  });
}

// Get access token from DocuSign
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token;
  }

  const jwtToken = generateJWT();

  const response = await fetch(`${DOCUSIGN_ENVIRONMENT}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwtToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DocuSign authentication failed: ${error}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

// Send contract for signing
export async function sendContractForSigning(
  contractBody: string,
  contractTitle: string,
  recipientEmail: string,
  recipientName: string,
  returnUrl: string,
): Promise<{ envelopeId: string; signingUrl: string }> {
  const accessToken = await getAccessToken();

  const apiClient = new ApiClient();
  apiClient.setBasePath(`${DOCUSIGN_ENVIRONMENT}/restapi`);
  apiClient.addDefaultHeader("Authorization", `Bearer ${accessToken}`);

  const envelopesApi = new EnvelopesApi(apiClient);

  // Create the envelope definition
  const document = new Document();
  document.documentBase64 = Buffer.from(contractBody).toString("base64");
  document.name = contractTitle;
  document.documentId = "1";

  const signer = new Signer();
  signer.email = recipientEmail;
  signer.name = recipientName;
  signer.recipientId = "1";
  signer.routingOrder = "1";

  const signHere = new SignHere();
  signHere.documentId = "1";
  signHere.pageNumber = "1";
  signHere.xPosition = "100";
  signHere.yPosition = "100";

  const tabs = new Tabs();
  tabs.signHereTabs = [signHere];
  signer.tabs = tabs;

  const envelopeDefinition = new EnvelopeDefinition();
  envelopeDefinition.emailSubject = `Please sign: ${contractTitle}`;
  envelopeDefinition.documents = [document];
  envelopeDefinition.recipients = {
    signers: [signer],
  };
  envelopeDefinition.status = "sent";

  // Send the envelope
  const result = await envelopesApi.createEnvelope(DOCUSIGN_ACCOUNT_ID!, {
    envelopeDefinition,
  });

  // Get signing URL using embedded signing
  const viewRequest = {
    returnUrl,
    userName: recipientName,
    email: recipientEmail,
    clientUserId: "1",
  };

  const viewResult = await envelopesApi.createRecipientView(DOCUSIGN_ACCOUNT_ID!, result.envelopeId!, {
    recipientViewRequest: viewRequest,
  });

  return {
    envelopeId: result.envelopeId!,
    signingUrl: viewResult.url!,
  };
}

// Get envelope status
export async function getEnvelopeStatus(envelopeId: string): Promise<string> {
  const accessToken = await getAccessToken();

  const apiClient = new ApiClient();
  apiClient.setBasePath(`${DOCUSIGN_ENVIRONMENT}/restapi`);
  apiClient.addDefaultHeader("Authorization", `Bearer ${accessToken}`);

  const envelopesApi = new EnvelopesApi(apiClient);
  const result = await envelopesApi.getEnvelope(DOCUSIGN_ACCOUNT_ID!, envelopeId);

  return result.status || "unknown";
}

// Get signed document
export async function getSignedDocument(envelopeId: string): Promise<Buffer> {
  const accessToken = await getAccessToken();

  const apiClient = new ApiClient();
  apiClient.setBasePath(`${DOCUSIGN_ENVIRONMENT}/restapi`);
  apiClient.addDefaultHeader("Authorization", `Bearer ${accessToken}`);

  const envelopesApi = new EnvelopesApi(apiClient);

  // Get the combined document (all documents in the envelope)
  const result = await envelopesApi.getDocument(DOCUSIGN_ACCOUNT_ID!, envelopeId, "combined");

  return result as unknown as Buffer;
}

// Verify webhook signature (for webhook security)
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const crypto = require("crypto");
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const hash = hmac.digest("base64");
  return hash === signature;
}
