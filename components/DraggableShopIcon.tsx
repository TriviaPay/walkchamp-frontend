import React, { useRef, useState, useEffect, useCallback } from "react";
import { Animated, Dimensions, Image, PanResponder, StyleSheet } from "react-native";
import { storageGet, storageSet } from "@/utils/storage";

// Match the profile avatar size (42px) — slightly larger outer container
const SHOP_SIZE = 47;
const IMG_SIZE = 39;
const DRAG_THRESHOLD = 5;
const IDLE_DELAY = 5000;
const IDLE_OPACITY = 0.45;
const SHOP_POS_KEY = "walkchamp_shop_icon_pos";

const shopImage = require("@/assets/images/shop-icon.png");

interface Props {
  tabBarHeight: number;
  onOpenStore: () => void;
  /** Pass true every time the Walk screen comes into focus to reset opacity. */
  focused?: boolean;
}

export default function DraggableShopIcon({ tabBarHeight, onOpenStore, focused }: Props) {
  const tabBarHeightRef = useRef(tabBarHeight);
  const onOpenStoreRef = useRef(onOpenStore);
  useEffect(() => { tabBarHeightRef.current = tabBarHeight; }, [tabBarHeight]);
  useEffect(() => { onOpenStoreRef.current = onOpenStore; }, [onOpenStore]);

  const getDefault = (): { x: number; y: number } => {
    const { width: W, height: H } = Dimensions.get("window");
    return { x: W - SHOP_SIZE - 18, y: H - tabBarHeightRef.current - SHOP_SIZE - 60 };
  };

  // IMPORTANT: All animated values used on the same Animated.View must share
  // the same driver. Since position cannot use useNativeDriver:true, we use
  // useNativeDriver:false everywhere to avoid the "mixed driver" crash.
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);
  const [ready, setReady] = useState(false);

  // ── opacity helpers ────────────────────────────────────────────────────────
  const clearIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const startIdleTimer = useCallback(() => {
    clearIdle();
    idleTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: IDLE_OPACITY,
        duration: 600,
        useNativeDriver: false,
      }).start();
    }, IDLE_DELAY);
  }, [clearIdle, opacity]);

  const bringToFull = useCallback(() => {
    clearIdle();
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [clearIdle, opacity]);

  // ── focus reset (called from walk.tsx via focused prop) ────────────────────
  useEffect(() => {
    if (focused && ready) {
      bringToFull();
      startIdleTimer();
    }
  }, [focused, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── load saved position ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { width: W, height: H } = Dimensions.get("window");
      let pos = getDefault();
      const saved = await storageGet<{ x: number; y: number }>(SHOP_POS_KEY);
      if (
        saved &&
        typeof saved.x === "number" &&
        typeof saved.y === "number" &&
        saved.x >= 0 &&
        saved.x <= W - SHOP_SIZE &&
        saved.y >= 60 &&
        saved.y <= H - 60
      ) {
        pos = saved;
      }
      pan.setValue(pos);
      setReady(true);
      startIdleTimer();
    })();
    return () => clearIdle();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PanResponder ───────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2,

      onPanResponderGrant: () => {
        isDragging.current = false;
        // Capture current position as offset so gesture delta starts at 0
        pan.setOffset({
          x: (pan.x as unknown as { _value: number })._value,
          y: (pan.y as unknown as { _value: number })._value,
        });
        pan.setValue({ x: 0, y: 0 });
        // Restore full opacity immediately on touch
        clearIdle();
        Animated.timing(opacity, { toValue: 1, duration: 100, useNativeDriver: false }).start();
      },

      onPanResponderMove: (_, gs) => {
        if (Math.abs(gs.dx) > DRAG_THRESHOLD || Math.abs(gs.dy) > DRAG_THRESHOLD) {
          isDragging.current = true;
        }
        pan.setValue({ x: gs.dx, y: gs.dy });
      },

      onPanResponderRelease: (_, gs) => {
        pan.flattenOffset();

        const wasDrag = isDragging.current;
        isDragging.current = false;

        if (wasDrag) {
          const { width: W, height: H } = Dimensions.get("window");
          const tb = tabBarHeightRef.current;
          const rawX = (pan.x as unknown as { _value: number })._value;
          const rawY = (pan.y as unknown as { _value: number })._value;

          // Snap to nearest horizontal edge
          const snapX = rawX + SHOP_SIZE / 2 > W / 2 ? W - SHOP_SIZE - 18 : 18;
          const clampY = Math.max(80, Math.min(rawY, H - tb - SHOP_SIZE - 16));
          const newPos = { x: snapX, y: clampY };

          Animated.spring(pan, {
            toValue: newPos,
            friction: 7,
            tension: 120,
            useNativeDriver: false,
          }).start();

          storageSet(SHOP_POS_KEY, newPos);
        } else {
          // Pure tap — open store
          onOpenStoreRef.current();
        }

        // Restart idle fade after interaction ends
        startIdleTimer();
      },

      onPanResponderTerminate: () => {
        pan.flattenOffset();
        isDragging.current = false;
        startIdleTimer();
      },

      // Allow other responders (scroll views, navigation) to take over.
      // Returning false was causing the responder to stay locked after navigation,
      // swallowing all touches and making the screen appear frozen.
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  if (!ready) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
          opacity,
        },
      ]}
      {...panResponder.panHandlers}
      accessible
      accessibilityLabel="Open Coins Store"
      accessibilityRole="button"
    >
      <Image source={shopImage} style={styles.image} resizeMode="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 200,
    width: SHOP_SIZE,
    height: SHOP_SIZE,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 7,
  },
  image: {
    width: IMG_SIZE,
    height: IMG_SIZE,
  },
});
