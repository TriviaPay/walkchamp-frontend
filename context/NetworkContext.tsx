/**
 * Network connectivity — NetInfo wrapper + reconnect flush hooks.
 * Online behavior matches the previous app; offline adds banner + action guards.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { raceStepSyncBuffer } from "@/services/raceStepSyncBuffer";
import { AppAlert } from "@/components/AppAlert";

export type NetworkStatus = {
  isOnline: boolean;
  isInternetReachable: boolean | null;
  type: string;
};

type NetworkContextValue = NetworkStatus & {
  /** Returns false and shows an alert when offline. */
  requireOnline: (message?: string) => boolean;
  refreshNetworkState: () => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

const DEFAULT_OFFLINE_MESSAGE =
  "You're offline. Reconnect to the internet to continue this action.";

function deriveOnline(state: NetInfoState): boolean {
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

type FlushFn = () => void | Promise<void>;
const reconnectFlushHandlers = new Set<FlushFn>();

/** Register a reconnect flush (e.g. walk outbox). Safe to call from providers. */
export function registerReconnectFlush(fn: FlushFn): () => void {
  reconnectFlushHandlers.add(fn);
  return () => {
    reconnectFlushHandlers.delete(fn);
  };
}

async function runReconnectFlushes(): Promise<void> {
  // Race step buffer is always safe / idempotent (force flush).
  try {
    await raceStepSyncBuffer.flushRaceSteps({ force: true, reason: "resume" });
  } catch {
    /* keep going — other flushes still run */
  }
  for (const fn of reconnectFlushHandlers) {
    try {
      await fn();
    } catch {
      /* individual flush failure must not break others */
    }
  }
}

export function NetworkProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    isInternetReachable: null,
    type: "unknown",
  });
  const wasOnlineRef = useRef(true);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyState = useCallback((state: NetInfoState) => {
    const isOnline = deriveOnline(state);
    setStatus({
      isOnline,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
    });

    if (!wasOnlineRef.current && isOnline) {
      // Debounce flicker reconnects.
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        void runReconnectFlushes();
      }, 600);
    }
    wasOnlineRef.current = isOnline;
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsub = NetInfo.addEventListener((state) => {
      if (mounted) applyState(state);
    });
    void NetInfo.fetch().then((state) => {
      if (mounted) applyState(state);
    });
    return () => {
      mounted = false;
      unsub();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [applyState]);

  const requireOnline = useCallback(
    (message?: string) => {
      if (status.isOnline) return true;
      AppAlert.alert("You're offline", message ?? DEFAULT_OFFLINE_MESSAGE);
      return false;
    },
    [status.isOnline],
  );

  const refreshNetworkState = useCallback(async () => {
    const state = await NetInfo.fetch();
    applyState(state);
  }, [applyState]);

  const value = useMemo<NetworkContextValue>(
    () => ({
      ...status,
      requireOnline,
      refreshNetworkState,
    }),
    [status, requireOnline, refreshNetworkState],
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

const FALLBACK: NetworkContextValue = {
  isOnline: true,
  isInternetReachable: null,
  type: "unknown",
  requireOnline: () => true,
  refreshNetworkState: async () => {},
};

export function useNetwork(): NetworkContextValue {
  return useContext(NetworkContext) ?? FALLBACK;
}
