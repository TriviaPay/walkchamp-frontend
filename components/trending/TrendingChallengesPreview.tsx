/**
 * Walk-tab Trending Challenges preview — below Create Challenge.
 * Feature-flagged. Free / coins / cash / unlimited upcoming rooms.
 * Never show blank/skeleton cards — hide until real (or cached) data exists.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  DeviceEventEmitter,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { TrendingChallengeStack } from "@/components/trending/TrendingChallengeStack";
import { TrendingChallengeDots } from "@/components/trending/TrendingChallengeDots";
import { TrendingChallengesTagline } from "@/components/trending/TrendingChallengesTagline";
import { useTrendingChallengeAutoplay } from "@/hooks/useTrendingChallengeAutoplay";
import { fetchTrendingChallenges } from "@/services/trendingChallengesApi";
import { trackEvent } from "@/services/analytics";
import { buildMatchmakingParams } from "@/utils/waitingRoomSeed";
import { useAuth } from "@/context/AuthContext";
import { screenCache } from "@/utils/screenCache";
import type { TrendingChallenge } from "@/utils/trendingChallenges";
import {
  shouldShowTrendingPreview,
  TRENDING_PREVIEW_CACHE_TTL_MS,
  trendingPreviewCacheKey,
} from "@/utils/trendingChallenges";
import { rf } from "@/utils/responsive";
import * as Haptics from "@/utils/haptics";
import { CHALLENGE_LEFT_EVENT } from "@/utils/challengeLocalEvents";
import { connectPusher, subscribeToChannel } from "@/services/realtimeService";

type Props = {
  /** Report count so Walk can show View All on the Join a Challenge row. */
  onCountChange?: (count: number) => void;
};

function applyJoinedCount(
  rows: TrendingChallenge[],
  roomId: string,
  nextCount: number | undefined,
  delta: -1 | 1 | 0,
): TrendingChallenge[] {
  return rows.map((c) => {
    if (c.id !== roomId) return c;
    if (typeof nextCount === "number" && Number.isFinite(nextCount)) {
      return { ...c, participantCount: Math.max(0, Math.floor(nextCount)) };
    }
    if (delta === 0) return c;
    return {
      ...c,
      participantCount: Math.max(0, c.participantCount + delta),
    };
  });
}

function TrendingChallengesPreviewInner({ onCountChange }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { width: winW } = useWindowDimensions();
  const contentWidth = Math.max(winW - 32, 280);
  const cardWidth = Math.min(contentWidth * 0.58, 210);
  const cardHeight = Math.min(Math.max(cardWidth * 1.02, 196), 210);

  const cacheKey = trendingPreviewCacheKey(user?.id);
  const [challenges, setChallenges] = useState<TrendingChallenge[]>(
    () => screenCache.getSync<TrendingChallenge[]>(cacheKey, TRENDING_PREVIEW_CACHE_TTL_MS) ?? [],
  );
  const [loading, setLoading] = useState(() => !shouldShowTrendingPreview(challenges));
  const impressedRef = useRef(false);
  const cardImpressedRef = useRef<string | null>(null);
  const challengesRef = useRef(challenges);
  challengesRef.current = challenges;
  const prevUserIdRef = useRef(user?.id);

  useEffect(() => {
    if (prevUserIdRef.current === user?.id) return;
    prevUserIdRef.current = user?.id;
    const nextKey = trendingPreviewCacheKey(user?.id);
    const cached =
      screenCache.getSync<TrendingChallenge[]>(nextKey, TRENDING_PREVIEW_CACHE_TTL_MS) ?? [];
    setChallenges(cached);
    onCountChange?.(cached.length);
  }, [onCountChange, user?.id]);

  useEffect(() => {
    let cancelled = false;
    void screenCache.get<TrendingChallenge[]>(cacheKey, TRENDING_PREVIEW_CACHE_TTL_MS).then((disk) => {
      if (cancelled || !shouldShowTrendingPreview(disk)) return;
      setChallenges((prev) => (shouldShowTrendingPreview(prev) ? prev : disk ?? prev));
    });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  const load = useCallback(async () => {
    const hasVisible = shouldShowTrendingPreview(challengesRef.current);
    if (!hasVisible) setLoading(true);
    try {
      const rows = await fetchTrendingChallenges({ viewerUserId: user?.id });
      setChallenges(rows);
      onCountChange?.(rows.length);
      void screenCache.set(trendingPreviewCacheKey(user?.id), rows);
      if (rows.length === 0) {
        trackEvent("walk_trending_preview_empty", { variant: "preview_below_create" });
      }
    } catch {
      trackEvent("walk_trending_preview_error", { variant: "preview_below_create" });
      if (!shouldShowTrendingPreview(challengesRef.current)) onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onCountChange, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Instant Joined count updates after leave/join (same channel Available Rooms uses).
  useEffect(() => {
    connectPusher();
    const channel = subscribeToChannel("public-rooms-available");
    if (!channel) return;

    const onCountEvent = (
      data: {
        room_id?: string;
        raceId?: string;
        registered_count?: number;
        current_players?: number;
        participantCount?: number;
      },
      delta: -1 | 1,
    ) => {
      const roomId = data.room_id ?? data.raceId;
      if (!roomId) return;
      const explicit =
        data.registered_count ?? data.current_players ?? data.participantCount;
      setChallenges((prev) => applyJoinedCount(prev, roomId, explicit, delta));
    };

    const onJoined = (data: {
      room_id?: string;
      raceId?: string;
      registered_count?: number;
      current_players?: number;
      participantCount?: number;
    }) => onCountEvent(data, 1);

    const onLeft = (data: {
      room_id?: string;
      raceId?: string;
      registered_count?: number;
      current_players?: number;
      participantCount?: number;
    }) => onCountEvent(data, -1);

    channel.bind("room:registered", onJoined);
    channel.bind("room:participant_joined", onJoined);
    channel.bind("room:registration_cancelled", onLeft);
    channel.bind("room:participant_left", onLeft);

    return () => {
      channel.unbind("room:registered", onJoined);
      channel.unbind("room:participant_joined", onJoined);
      channel.unbind("room:registration_cancelled", onLeft);
      channel.unbind("room:participant_left", onLeft);
    };
  }, []);

  // Local leave from Waiting Room → decrement immediately, then soft-refetch.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      CHALLENGE_LEFT_EVENT,
      (payload: { raceId?: string }) => {
        const raceId = payload?.raceId;
        if (!raceId) return;
        setChallenges((prev) => applyJoinedCount(prev, raceId, undefined, -1));
        // Confirm against server without blocking UI.
        void load();
      },
    );
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    if (!impressedRef.current && !loading) {
      impressedRef.current = true;
      trackEvent("walk_trending_preview_impression", {
        variant: "preview_below_create",
        count: challenges.length,
      });
    }
  }, [loading, challenges.length]);

  const { index, setIndex, pause, resumeSoon } = useTrendingChallengeAutoplay({
    count: challenges.length,
    enabled: false, // user scrolls manually — avoid snap flash from autoplay
    onAutoAdvance: () => {},
  });

  useEffect(() => {
    const c = challenges[index];
    if (!c || loading) return;
    if (cardImpressedRef.current === c.id) return;
    cardImpressedRef.current = c.id;
    trackEvent("walk_trending_preview_card_impression", {
      challengeId: c.id,
      position: index,
      challengeFormat: c.challengeFormat,
      variant: "preview_below_create",
    });
  }, [challenges, index, loading]);

  const openChallenge = (c: TrendingChallenge) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    trackEvent("walk_trending_preview_card_opened", {
      challengeId: c.id,
      position: index,
      challengeFormat: c.challengeFormat,
      source: "walk_trending_preview",
      variant: "preview_below_create",
    });
    if (c.id.startsWith("mock-")) {
      router.push("/rooms/available");
      return;
    }
    const isHost = !!user?.id && !!c.hostUserId && user.id === c.hostUserId;
    // Already hosting → waiting room. New joiners → Available Rooms confirmation first.
    if (isHost) {
      router.push({
        pathname: "/race/matchmaking",
        params: buildMatchmakingParams({
          raceId: c.id,
          isHost: true,
          user,
          initialScheduledStartAt: c.startsAtUtc,
          initialEntryType:
            c.challengeFormat === "unlimited_goal"
              ? "unlimited_goal"
              : c.challengeFormat === "fixed_cash"
                ? "paid_usd"
                : undefined,
          initialMaxPlayers: c.challengeFormat === "unlimited_goal" ? null : undefined,
          initialCurrentPlayers: Math.max(0, c.participantCount),
        }),
      });
      return;
    }
    router.push({
      pathname: "/rooms/available",
      params: { confirmRoomId: c.id },
    });
  };

  const onCarouselIndexChange = useCallback(
    (nextIndex: number, meta: { fromSwipe: boolean }) => {
      const prev = index;
      setIndex(nextIndex);
      if (meta.fromSwipe) {
        const c = challenges[nextIndex];
        trackEvent("walk_trending_preview_swiped", {
          direction:
            nextIndex > prev || (prev === challenges.length - 1 && nextIndex === 0)
              ? "next"
              : "prev",
          challengeId: c?.id,
          position: nextIndex,
          variant: "preview_below_create",
        });
        resumeSoon();
      }
    },
    [challenges, index, resumeSoon, setIndex],
  );

  if (!shouldShowTrendingPreview(challenges)) {
    return null;
  }

  return (
    <View style={styles.section} accessibilityLabel="Trending Challenges">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Trending Challenges</Text>
          <TrendingChallengesTagline />
        </View>
      </View>

      <TrendingChallengeStack
        challenges={challenges}
        activeIndex={index}
        cardWidth={cardWidth}
        cardHeight={cardHeight}
        onIndexChange={onCarouselIndexChange}
        onOpenChallenge={(id) => {
          const c = challenges.find((x) => x.id === id);
          if (c) openChallenge(c);
        }}
        onGestureStart={pause}
        onGestureEnd={resumeSoon}
      />
      {challenges.length > 1 ? (
        <TrendingChallengeDots
          count={challenges.length}
          activeIndex={index}
          accent="#22D3EE"
        />
      ) : null}
    </View>
  );
}

export const TrendingChallengesPreview = memo(TrendingChallengesPreviewInner);

const styles = StyleSheet.create({
  section: {
    marginTop: 22,
    marginBottom: 4,
    overflow: "visible",
    marginHorizontal: -16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
    paddingHorizontal: 16,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#FFF",
    fontSize: rf(17),
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 2,
    color: "rgba(148,163,184,0.9)",
    fontSize: rf(11),
    fontWeight: "500",
  },
});
