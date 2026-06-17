import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface BannerItem {
  id: string;
  type: "finish_goal" | "coins_earned";
  // finish_goal fields
  headline?: string;
  username?: string;  // participant display name (used when isMe === false)
  body?: string;      // suffix text after the name, e.g. "completed the goal in 1st place!"
  isMe?: boolean;
  emoji?: string;
  isGold?: boolean;
  // coins_earned fields
  coins?: number;
  description?: string;
  // common
  haptic: "success" | "light";
  durationMs: number;
}

interface TopBannerContextValue {
  enqueueBanner: (item: BannerItem) => void;
  visible: BannerItem[];
  dismissBanner: (id: string) => void;
}

const TopBannerContext = createContext<TopBannerContextValue>({
  enqueueBanner: () => {},
  visible: [],
  dismissBanner: () => {},
});

const STAGGER_DELAY_MS = 1600;

export function TopBannerProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState<BannerItem[]>([]);
  const queueRef = useRef<BannerItem[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const staggerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const promoteNext = useCallback(() => {
    if (staggerTimer.current) return;
    staggerTimer.current = setTimeout(() => {
      staggerTimer.current = null;
      setVisible((curr) => {
        if (curr.length >= 2 || queueRef.current.length === 0) return curr;
        const [next, ...rest] = queueRef.current;
        queueRef.current = rest;
        return [...curr, next];
      });
    }, STAGGER_DELAY_MS);
  }, []);

  const dismissBanner = useCallback(
    (id: string) => {
      const t = dismissTimers.current.get(id);
      if (t) { clearTimeout(t); dismissTimers.current.delete(id); }
      setVisible((prev) => {
        const next = prev.filter((b) => b.id !== id);
        // If queue has items and a slot just opened, schedule promotion
        if (queueRef.current.length > 0 && next.length < 2) {
          promoteNext();
        }
        return next;
      });
    },
    [promoteNext],
  );

  const enqueueBanner = useCallback(
    (item: BannerItem) => {
      // Dedup: ignore if same id was recently shown
      if (seenIds.current.has(item.id)) return;
      seenIds.current.add(item.id);
      setTimeout(() => seenIds.current.delete(item.id), 30_000);

      setVisible((curr) => {
        if (curr.length === 0) {
          // Empty — show immediately
          return [item];
        } else if (curr.length === 1) {
          // One already showing — stagger second
          queueRef.current.push(item);
          promoteNext();
          return curr;
        } else {
          // Both slots full — queue for later
          queueRef.current.push(item);
          return curr;
        }
      });
    },
    [promoteNext],
  );

  // Schedule auto-dismiss for each newly added visible banner
  useEffect(() => {
    visible.forEach((banner) => {
      if (!dismissTimers.current.has(banner.id)) {
        const t = setTimeout(() => dismissBanner(banner.id), banner.durationMs);
        dismissTimers.current.set(banner.id, t);
      }
    });
  }, [visible, dismissBanner]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      dismissTimers.current.forEach((t) => clearTimeout(t));
      if (staggerTimer.current) clearTimeout(staggerTimer.current);
    },
    [],
  );

  return (
    <TopBannerContext.Provider value={{ enqueueBanner, visible, dismissBanner }}>
      {children}
    </TopBannerContext.Provider>
  );
}

export function useTopBanner() {
  return useContext(TopBannerContext);
}
