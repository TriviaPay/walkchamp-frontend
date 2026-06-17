/**
 * authEvents — lightweight pub/sub bus for auth lifecycle events.
 *
 * Decouples authFetch (which cannot import React contexts) from
 * AuthContext (which must react to auth state changes).
 *
 * Events:
 *   SESSION_EXPIRED — fired when both the access token AND refresh token are
 *                     unrecoverable. AuthContext listens and forces logout so
 *                     the routing guard redirects to the login screen.
 *   TOKEN_REFRESHED — fired when authFetch successfully exchanges a refresh
 *                     token for a new access token. AuthContext listens and
 *                     keeps the Redux sessionToken in sync with SecureStore.
 */

type VoidListener = () => void;
type TokenListener = (newSessionToken: string) => void;

const sessionExpiredSet = new Set<VoidListener>();
const tokenRefreshedSet = new Set<TokenListener>();

// Guards against emitting SESSION_EXPIRED multiple times in rapid succession
// (e.g. several concurrent requests all fail together).
let sessionExpiredDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const authEvents = {
  /** Subscribe to the SESSION_EXPIRED event. Returns an unsubscribe function. */
  onSessionExpired(cb: VoidListener): VoidListener {
    sessionExpiredSet.add(cb);
    return () => sessionExpiredSet.delete(cb);
  },

  /**
   * Emit SESSION_EXPIRED. Debounced to 50 ms so a burst of concurrent
   * failures only triggers one logout, not N.
   */
  emitSessionExpired(): void {
    if (sessionExpiredDebounceTimer) return;
    sessionExpiredDebounceTimer = setTimeout(() => {
      sessionExpiredDebounceTimer = null;
      sessionExpiredSet.forEach((cb) => cb());
    }, 50);
  },

  /** Subscribe to the TOKEN_REFRESHED event. Returns an unsubscribe function. */
  onTokenRefreshed(cb: TokenListener): VoidListener {
    tokenRefreshedSet.add(cb);
    return () => tokenRefreshedSet.delete(cb);
  },

  /** Emit TOKEN_REFRESHED with the newly minted session JWT. */
  emitTokenRefreshed(newSessionToken: string): void {
    tokenRefreshedSet.forEach((cb) => cb(newSessionToken));
  },
};
