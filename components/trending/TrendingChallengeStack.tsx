/**
 * Horizontal Unlimited Challenge carousel — velocity-based snap scroll.
 */

import React, { memo, useCallback, useRef } from "react";
import {
  FlatList,
  type ListRenderItemInfo,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { TrendingChallengeCard } from "@/components/trending/TrendingChallengeCard";
import type { TrendingChallenge } from "@/utils/trendingChallenges";

type Props = {
  challenges: TrendingChallenge[];
  activeIndex: number;
  cardWidth: number;
  cardHeight: number;
  onIndexChange: (index: number, meta: { fromSwipe: boolean }) => void;
  onOpenChallenge: (challengeId: string) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
};

const GAP = 10;
const SIDE_PAD = 16;

function TrendingChallengeStackInner({
  challenges,
  activeIndex,
  cardWidth,
  cardHeight,
  onIndexChange,
  onOpenChallenge,
  onGestureStart,
  onGestureEnd,
}: Props) {
  const listRef = useRef<FlatList<TrendingChallenge>>(null);
  const indexRef = useRef(activeIndex);
  const draggingRef = useRef(false);
  const step = cardWidth + GAP;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index == null) return;
      if (first.index === indexRef.current) return;
      indexRef.current = first.index;
      onIndexChange(first.index, { fromSwipe: draggingRef.current });
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 55,
  }).current;

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<TrendingChallenge>) => (
      <View style={[styles.cardSlot, { width: cardWidth, height: cardHeight, marginRight: GAP }]}>
        <TrendingChallengeCard
          challenge={item}
          width={cardWidth}
          height={cardHeight}
          onPress={() => onOpenChallenge(item.id)}
          positionLabel={`${index + 1} of ${challenges.length}`}
        />
      </View>
    ),
    [cardHeight, cardWidth, challenges.length, onOpenChallenge],
  );

  const onScrollBeginDrag = useCallback(() => {
    draggingRef.current = true;
    onGestureStart();
  }, [onGestureStart]);

  const settleFromOffset = useCallback(
    (x: number) => {
      const next = Math.max(0, Math.min(challenges.length - 1, Math.round(x / step)));
      if (next !== indexRef.current) {
        indexRef.current = next;
        onIndexChange(next, { fromSwipe: true });
      }
      onGestureEnd();
    },
    [challenges.length, onGestureEnd, onIndexChange, step],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      draggingRef.current = false;
      settleFromOffset(e.nativeEvent.contentOffset.x);
    },
    [settleFromOffset],
  );

  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Slow drag with no momentum — settle index when finger lifts
      const vx = e.nativeEvent.velocity?.x ?? 0;
      if (Math.abs(vx) < 0.05) {
        draggingRef.current = false;
        settleFromOffset(e.nativeEvent.contentOffset.x);
      }
    },
    [settleFromOffset],
  );

  if (challenges.length === 0) return null;

  return (
    <View style={[styles.stage, { height: cardHeight + 8 }]}>
      <FlatList
        ref={listRef}
        data={challenges}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        // Allow fast swipes to coast across multiple cards; still snap to intervals.
        decelerationRate="normal"
        snapToInterval={step}
        snapToAlignment="start"
        disableIntervalMomentum={false}
        bounces
        overScrollMode="never"
        nestedScrollEnabled
        directionalLockEnabled
        contentContainerStyle={styles.content}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: step,
          offset: step * index,
          index,
        })}
        initialScrollIndex={Math.min(activeIndex, Math.max(0, challenges.length - 1))}
      />
    </View>
  );
}

export const TrendingChallengeStack = memo(TrendingChallengeStackInner);

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    overflow: "visible",
  },
  content: {
    paddingLeft: SIDE_PAD,
    paddingRight: SIDE_PAD,
    alignItems: "center",
  },
  cardSlot: {
    justifyContent: "center",
    alignItems: "center",
  },
});
