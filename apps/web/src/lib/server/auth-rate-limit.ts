const UNKNOWN_CLIENT_KEY = "client:unknown";
const INVALID_ACCOUNT_KEY = "account:invalid";

function clientKey(headers: Headers): string {
  const address = headers.get("cf-connecting-ip")?.trim();
  if (!address || address.length > 64 || !/^[0-9a-f:.]+$/i.test(address)) {
    return UNKNOWN_CLIENT_KEY;
  }
  return `client:${address.toLowerCase()}`;
}

async function accountKey(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 254) return INVALID_ACCOUNT_KEY;
  const bytes = new TextEncoder().encode(normalized);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `account:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function allowCredentialAttempt(
  edgeLimiter: RateLimit,
  accountLimiter: RateLimit,
  headers: Headers,
  email: string,
): Promise<boolean> {
  const [edge, account] = await Promise.all([
    edgeLimiter.limit({ key: clientKey(headers) }),
    accountLimiter.limit({ key: await accountKey(email) }),
  ]);
  return edge.success && account.success;
}

export async function emailFromBetterAuthRequest(request: Request): Promise<string> {
  try {
    const value: unknown = await request.clone().json();
    if (value === null || typeof value !== "object" || !("email" in value)) return "";
    return typeof value.email === "string" ? value.email : "";
  } catch {
    return "";
  }
}
