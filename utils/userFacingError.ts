/**
 * Maps internal/network/API errors to safe, actionable user-facing copy.
 * Preserves specific messages when they are already user-safe.
 */

export type UserFacingErrorContext =
  | "generic"
  | "network"
  | "auth"
  | "payment"
  | "wallet"
  | "iap"
  | "signup"
  | "chat"
  | "race";

const NETWORK_PATTERNS =
  /network|fetch|timeout|timed out|abort|econnreset|enotfound|offline|internet|socket|failed to connect/i;

const AUTH_PATTERNS =
  /not authenticated|no session|session expired|unauthorized|invalid credentials|invalid grant/i;

const PAYMENT_PATTERNS =
  /payment|stripe|razorpay|checkout|deposit|withdraw|purchase|billing/i;

function isLikelyInternalMessage(message: string): boolean {
  if (!message.trim()) return true;
  if (message.includes(" at ") && message.includes(".tsx")) return true;
  if (message.includes(" at ") && message.includes(".ts:")) return true;
  if (/^\[object Object\]$/i.test(message)) return true;
  if (/^undefined$|^null$/i.test(message)) return true;
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) return true;
  if (/internal server error|500|502|503|504/i.test(message) && message.length > 80) return true;
  return false;
}

function contextDefault(context: UserFacingErrorContext): string {
  switch (context) {
    case "network":
      return "We couldn't connect. Check your internet connection and try again.";
    case "auth":
      return "Your session expired. Please sign in again.";
    case "payment":
    case "wallet":
      return "We couldn't complete the payment. Please try again.";
    case "iap":
      return "We couldn't complete the purchase. Please try again.";
    case "signup":
      return "We couldn't create your account. Please check your details and try again.";
    case "chat":
      return "We couldn't send your message. Please try again.";
    case "race":
      return "We couldn't complete that race action. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Extract a message from unknown thrown values without exposing objects.
 */
export function extractErrorMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string") return msg.trim();
  }
  return "";
}

/**
 * Map API JSON error bodies to user-safe strings when possible.
 */
export function mapApiErrorBody(body: unknown, context: UserFacingErrorContext = "generic"): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const candidates = [record.error, record.message, record.detail];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !isLikelyInternalMessage(c)) {
      return c.trim();
    }
  }
  void context;
  return null;
}

/**
 * Convert any error to safe user-facing copy.
 */
export function toUserFacingError(
  err: unknown,
  context: UserFacingErrorContext = "generic",
): string {
  const raw = extractErrorMessage(err);
  if (raw && !isLikelyInternalMessage(raw)) {
    if (NETWORK_PATTERNS.test(raw)) {
      return contextDefault("network");
    }
    if (AUTH_PATTERNS.test(raw)) {
      return contextDefault("auth");
    }
    if (PAYMENT_PATTERNS.test(raw) && (context === "generic" || context === "wallet")) {
      return contextDefault("payment");
    }
    return raw;
  }
  return contextDefault(context);
}

/**
 * Parse a failed fetch Response into user-facing copy.
 */
export async function toUserFacingErrorFromResponse(
  res: Response,
  context: UserFacingErrorContext = "generic",
): Promise<string> {
  try {
    const body = await res.json();
    const mapped = mapApiErrorBody(body, context);
    if (mapped) return mapped;
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401 || res.status === 403) return contextDefault("auth");
  if (res.status === 429) return "Too many requests. Please wait a moment and try again.";
  if (res.status >= 500) return "Something went wrong on our side. Please try again shortly.";
  if (res.status === 404) return "We couldn't find what you were looking for.";
  return contextDefault(context);
}
