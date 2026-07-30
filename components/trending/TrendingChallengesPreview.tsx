/**

 * Walk-tab Unlimited Challenge preview — below Create Challenge.

 * Feature-flagged; cash unlimited + fixed-player only.

 * Hidden unless at least one joinable challenge is loaded.

 */



import React, { memo, useCallback, useEffect, useRef, useState } from "react";

import {

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

import type { TrendingChallenge } from "@/utils/trendingChallenges";

import { rf } from "@/utils/responsive";

import * as Haptics from "@/utils/haptics";



type Props = {

  /** Report count so Walk can show View All on the Join a Challenge row. */

  onCountChange?: (count: number) => void;

};



function TrendingChallengesPreviewInner({ onCountChange }: Props) {

  const router = useRouter();

  const { user } = useAuth();

  const { width: winW } = useWindowDimensions();

  const contentWidth = Math.max(winW - 32, 280);

  const cardWidth = Math.min(contentWidth * 0.58, 210);

  const cardHeight = Math.min(cardWidth * 1.02, 188);



  const [challenges, setChallenges] = useState<TrendingChallenge[]>([]);

  const [loading, setLoading] = useState(true);

  const impressedRef = useRef(false);

  const cardImpressedRef = useRef<string | null>(null);



  const load = useCallback(async () => {

    setLoading(true);

    try {

      const rows = await fetchTrendingChallenges({ viewerUserId: user?.id });

      setChallenges(rows);

      onCountChange?.(rows.length);

      if (rows.length === 0) {

        trackEvent("walk_trending_preview_empty", { variant: "preview_below_create" });

      }

    } catch {

      trackEvent("walk_trending_preview_error", { variant: "preview_below_create" });

      onCountChange?.(0);

    } finally {

      setLoading(false);

    }

  }, [onCountChange, user?.id]);



  useFocusEffect(

    useCallback(() => {

      void load();

    }, [load]),

  );



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

    router.push({

      pathname: "/race/matchmaking",

      params: buildMatchmakingParams({

        raceId: c.id,

        isHost: !!user?.id && !!c.hostUserId && user.id === c.hostUserId,

        user,

        initialScheduledStartAt: c.startsAtUtc,

        initialEntryType:
          c.challengeFormat === "unlimited_goal"
            ? "unlimited_goal"
            : c.challengeFormat === "fixed_cash"
              ? "paid_usd"
              : undefined,

        initialMaxPlayers: c.challengeFormat === "unlimited_goal" ? null : undefined,

        initialCurrentPlayers: Math.max(1, c.participantCount),

      }),

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



  if (challenges.length === 0) {

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

