import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CHANNELS, subscribeToChannel } from "@/services/realtimeService";

interface AvatarVersionContextType {
  getAvatarVersion: (userId: string, fallback?: number) => number;
  /** Bump version locally (upload/delete) — always wins over stale list data. */
  publishAvatarVersion: (userId: string, version: number) => void;
  getLocalPreview: (userId: string) => string | null;
  /** file:// URI shown instantly while upload propagates / before CDN cache warms. */
  setLocalPreview: (userId: string, uri: string | null) => void;
}

const AvatarVersionContext = createContext<AvatarVersionContextType>({
  getAvatarVersion: (_, fallback) => fallback ?? 0,
  publishAvatarVersion: () => {},
  getLocalPreview: () => null,
  setLocalPreview: () => {},
});

export function AvatarVersionProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;

    const handler = (data: { userId?: string; avatarVersion?: number }) => {
      if (!data?.userId) return;
      const v = data.avatarVersion ?? 0;
      setOverrides((prev) => ({
        ...prev,
        [data.userId!]: Math.max(prev[data.userId!] ?? 0, v),
      }));
    };

    channel.bind("avatar:updated", handler);
    return () => {
      channel.unbind("avatar:updated", handler);
    };
  }, []);

  const publishAvatarVersion = useCallback((userId: string, version: number) => {
    setOverrides((prev) => ({
      ...prev,
      [userId]: Math.max(prev[userId] ?? 0, version),
    }));
  }, []);

  const getAvatarVersion = useCallback(
    (userId: string, fallback = 0): number => {
      return Math.max(overrides[userId] ?? 0, fallback);
    },
    [overrides],
  );

  const getLocalPreview = useCallback(
    (userId: string): string | null => localPreviews[userId] ?? null,
    [localPreviews],
  );

  const setLocalPreview = useCallback((userId: string, uri: string | null) => {
    setLocalPreviews((prev) => {
      if (!uri) {
        if (!(userId in prev)) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      }
      return { ...prev, [userId]: uri };
    });
  }, []);

  const value = useMemo(
    () => ({
      getAvatarVersion,
      publishAvatarVersion,
      getLocalPreview,
      setLocalPreview,
    }),
    [getAvatarVersion, publishAvatarVersion, getLocalPreview, setLocalPreview],
  );

  return (
    <AvatarVersionContext.Provider value={value}>
      {children}
    </AvatarVersionContext.Provider>
  );
}

export function useAvatarVersionContext() {
  return useContext(AvatarVersionContext);
}
