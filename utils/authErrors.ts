/**
 * Thrown by getValidSession() when the Descope API definitively rejects the
 * refresh token (HTTP 4xx from Descope). This is distinct from a transient
 * network failure, which should NOT log the user out.
 *
 * Only catch this in authFetch.ts → emit authEvents.emitSessionExpired().
 * All other callers (e.g. AuthContext.refreshUserProfile) should let it
 * propagate to their outer catch {} block and swallow it silently.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — refresh token rejected by Descope");
    this.name = "SessionExpiredError";
  }
}
