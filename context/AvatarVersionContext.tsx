import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CHANNELS, subscribeToChannel } from "@/services/realtimeService";

interface AvatarVersionContextType {
  getAvatarVersion: (userId: string, fallback?: number) => number;
}

const AvatarVersionContext = createContext<AvatarVersionContextType>({
  getAvatarVersion: (_, fallback) => fallback ?? 0,
});

export function AvatarVersionProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;

    const handler = (data: { userId?: string; avatarVersion?: number }) => {
      if (!data?.userId) return;
      setOverrides((prev) => ({ ...prev, [data.userId!]: data.avatarVersion ?? 0 }));
    };

    channel.bind("avatar:updated", handler);
    return () => {
      channel.unbind("avatar:updated", handler);
    };
  }, []);

  const getAvatarVersion = useCallback((userId: string, fallback = 0): number => {
    return overrides[userId] ?? fallback;
  }, [overrides]);

  return (
    <AvatarVersionContext.Provider value={{ getAvatarVersion }}>
      {children}
    </AvatarVersionContext.Provider>
  );
}

export function useAvatarVersionContext() {
  return useContext(AvatarVersionContext);
}
