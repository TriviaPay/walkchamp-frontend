import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { getValidSession } from "@/services/authService";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export interface UnlockedTitleInfo {
  code:       string;
  title:      string;
  difficulty: string;
  icon:       string | null;
}

export interface ActiveTitleInfo {
  code:       string;
  title:      string;
  difficulty: string;
  icon:       string | null;
}

interface TitleUnlockContextValue {
  pendingUnlock:  UnlockedTitleInfo | null;
  triggerUnlocks: (titles: UnlockedTitleInfo[]) => void;
  dismissCurrent: () => void;
  equip:          () => Promise<ActiveTitleInfo | null>;
  lastEquipped:   ActiveTitleInfo | null;
}

const Ctx = createContext<TitleUnlockContextValue | null>(null);

export function TitleUnlockProvider({ children }: { children: React.ReactNode }) {
  const [queue,        setQueue]        = useState<UnlockedTitleInfo[]>([]);
  const [lastEquipped, setLastEquipped] = useState<ActiveTitleInfo | null>(null);
  const seenCodes = useRef(new Set<string>());

  const triggerUnlocks = useCallback((titles: UnlockedTitleInfo[]) => {
    const newOnes = titles.filter((t) => !seenCodes.current.has(t.code));
    if (!newOnes.length) return;
    newOnes.forEach((t) => seenCodes.current.add(t.code));
    setQueue((prev) => [...prev, ...newOnes]);
  }, []);

  const dismissCurrent = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const equip = useCallback(async (): Promise<ActiveTitleInfo | null> => {
    const current = queue[0];
    if (!current) return null;
    try {
      const session = await getValidSession();
      if (!session) return null;
      const res = await fetch(`${API_BASE}/api/titles/equip`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
        body: JSON.stringify({ achievement_code: current.code }),
      });
      const json = await res.json();
      if (!res.ok || !json.active_title) return null;
      const at: ActiveTitleInfo = json.active_title;
      setLastEquipped(at);
      return at;
    } catch {
      return null;
    }
  }, [queue]);

  const value = useMemo(
    () => ({ pendingUnlock: queue[0] ?? null, triggerUnlocks, dismissCurrent, equip, lastEquipped }),
    [queue, triggerUnlocks, dismissCurrent, equip, lastEquipped],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useTitleUnlock() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTitleUnlock requires TitleUnlockProvider");
  return ctx;
}
