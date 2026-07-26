import React, { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rf, rs, rv } from "@/utils/responsive";

const BG = "#EAF6E8";
const HILL = "#7BC47A";
const HILL_DARK = "#5AA85A";
const BUSH = "#4F9B4E";
const TITLE = "#2F3A33";
const TITLE_ACCENT = "#3D8B40";
const MUTED = "#6B7A70";
const TRACK_BORDER = "#FFFFFF";
const BAR_TRACK = "#C9E6C7";
const BAR_FILL = "#3D8B40";

const CLOUD_IMG = require("@/assets/images/cloud.png");
const APP_ICON_IMG = require("@/assets/icons/WalkChampProgress100.png");
const RACE_TRACK_LOTTIE = require("@/assets/lottie/raceTrack.json");
const WALKING_LOTTIE = require("@/assets/lottie/walking.json");
const SPLASH_APP_ICON_LOTTIE = require("@/assets/lottie/Splash App Icon.json");

const EXIT_MS = 520;
const HARD_TIMEOUT_MS = 30_000;
/** Splash App Icon.json = 90f @ 30fps → exactly 3000ms. */
const INTRO_DURATION_MS = 3000;
/** Tiny hold on last intro frame before crossfade. */
const INTRO_END_BUFFER_MS = 80;
const INTRO_FADE_MS = 420;
/** Hills + title + race card slide up (progress/walker stay fixed). */
const SLIDE_UP_MS = 720;
/** raceTrack.json = 328f @ 60fps → ~5467ms. */
const RACE_TRACK_DURATION_MS = 5470;
/** Progress fills in parallel with race — keeps total splash ~10s. */
const PROGRESS_DURATION_MS = 5500;
const LOTTIE_ASPECT = 1280 / 1080;
/** Static app icon nudge. */
const APP_ICON_NUDGE_X = -6;
const APP_ICON_NUDGE_Y = 20;

type SplashPhase = "intro" | "fading" | "sliding" | "playing" | "exiting";

interface Props {
  isReady: boolean;
  onFinish: () => void;
}

class SplashErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function getLottieView(): typeof import("lottie-react-native").default | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("lottie-react-native").default;
  } catch {
    return null;
  }
}

function RaceTrackLottie({
  style,
  playing,
  onComplete,
}: {
  style: object;
  playing: boolean;
  onComplete?: () => void;
}) {
  const LottieView = getLottieView();
  const ref = useRef<import("lottie-react-native").default | null>(null);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const markDone = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (!playing) return;
    doneRef.current = false;

    if (!LottieView) {
      const t = setTimeout(markDone, 400);
      return () => clearTimeout(t);
    }

    const play = () => {
      try {
        ref.current?.reset?.();
        ref.current?.play?.();
      } catch {
        /* ignore */
      }
    };

    const t0 = setTimeout(play, 16);
    const t1 = setTimeout(play, 100);
    const safety = setTimeout(markDone, RACE_TRACK_DURATION_MS + 250);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(safety);
    };
  }, [playing, LottieView, markDone]);

  if (!LottieView) {
    return <View style={[style, styles.lottieFallback]} />;
  }
  return (
    <LottieView
      ref={ref}
      source={RACE_TRACK_LOTTIE}
      autoPlay={false}
      loop={false}
      style={style}
      resizeMode="contain"
      renderMode="AUTOMATIC"
      hardwareAccelerationAndroid
      cacheComposition
      onAnimationFinish={markDone}
    />
  );
}

function WalkingLottie({ style }: { style: object }) {
  const LottieView = getLottieView();
  if (!LottieView) return null;
  return (
    <LottieView
      source={WALKING_LOTTIE}
      autoPlay
      loop
      style={style}
      resizeMode="contain"
      renderMode="AUTOMATIC"
      hardwareAccelerationAndroid
      cacheComposition
    />
  );
}

/** Intro icon — reports finish so we never cut the animation short. */
function SplashAppIconIntroLottie({ onFinished }: { onFinished: () => void }) {
  const LottieView = getLottieView();
  const doneRef = useRef(false);

  const markDone = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onFinished();
  }, [onFinished]);

  useEffect(() => {
    // Safety if onAnimationFinish never fires.
    const t = setTimeout(markDone, INTRO_DURATION_MS + 200);
    return () => clearTimeout(t);
  }, [markDone]);

  if (!LottieView) {
    return <View style={styles.introLottie} onLayout={markDone} />;
  }
  return (
    <LottieView
      source={SPLASH_APP_ICON_LOTTIE}
      autoPlay
      loop={false}
      style={styles.introLottie}
      resizeMode="cover"
      renderMode="AUTOMATIC"
      hardwareAccelerationAndroid
      onAnimationFinish={markDone}
    />
  );
}

function FloatingCloud({
  style,
  driftX,
  driftY,
  duration,
  delay = 0,
}: {
  style: object | object[];
  driftX: number;
  driftY: number;
  duration: number;
  delay?: number;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const drift = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(tx, {
              toValue: driftX,
              duration: duration / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(tx, {
              toValue: 0,
              duration: duration / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(ty, {
              toValue: driftY,
              duration: duration / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(ty, {
              toValue: -driftY * 0.6,
              duration: duration / 2,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
    );
    drift.start();
    return () => drift.stop();
  }, [delay, driftX, driftY, duration, tx, ty]);

  return (
    <Animated.Image
      source={CLOUD_IMG}
      resizeMode="contain"
      style={[
        styles.cloudImg,
        style,
        { transform: [{ translateX: tx }, { translateY: ty }] },
      ]}
    />
  );
}

/**
 * Sequence (~10s):
 * 1) Intro icon Lottie fully (+ clouds); race preloads off-screen
 * 2) Fade → static icon
 * 3) Slide up (race already warm)
 * 4) Race plays + progress/walker fill in parallel
 * 5) Exit when both done and app ready
 */
export function WalkChampSplash({ isReady, onFinish }: Props) {
  const finishedRef = useRef(false);
  const introFadeStartedRef = useRef(false);
  const slideStartedRef = useRef(false);
  const loadingStartedRef = useRef(false);
  const raceDoneRef = useRef(false);
  const progressDoneRef = useRef(false);
  const introDoneRef = useRef(false);

  const rootOpacity = useRef(new Animated.Value(1)).current;
  const rootScale = useRef(new Animated.Value(1)).current;
  const introOpacity = useRef(new Animated.Value(1)).current;
  const fixedIconOpacity = useRef(new Animated.Value(0)).current;
  const contentSlideY = useRef(new Animated.Value(2000)).current;
  const loadingOpacity = useRef(new Animated.Value(0)).current;
  const barProgress = useRef(new Animated.Value(0)).current;
  const walkerProgress = useRef(new Animated.Value(0)).current;
  const creepRef = useRef<Animated.CompositeAnimation | null>(null);

  const [phase, setPhase] = useState<SplashPhase>("intro");
  const [showIntroOverlay, setShowIntroOverlay] = useState(true);
  /** Mounted from t=0 off-screen so race composition preloads during intro. */
  const [showSlideContent] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState(0);
  const [raceComplete, setRaceComplete] = useState(false);
  const [progressComplete, setProgressComplete] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const layout = useMemo(() => {
    const short = Math.min(winW, winH);
    const tall = Math.max(winW, winH);
    const compact = tall < 720;
    const walker = Math.round(Math.min(48, Math.max(36, short * 0.1)));
    const appIcon = Math.round(Math.min(72, Math.max(56, short * 0.16)));
    return {
      padTop: insets.top + rs(28) + appIcon + rv(compact ? 14 : 18),
      progressBottom: Math.max(insets.bottom, rv(8)) + rv(compact ? 78 : 96) + 4,
      trackWidth: Math.min(short * (compact ? 0.72 : 0.78), rs(compact ? 240 : 300)),
      progressWidth: Math.min(short * 0.78, rs(300)),
      walker,
      walkerBarGap: 4,
      barH: Math.max(6, rs(8)),
      titleSize: rf(compact ? 44 : 52),
      appIcon,
      appIconTop: insets.top + rs(28) + APP_ICON_NUDGE_Y,
      appIconLeft: APP_ICON_NUDGE_X,
      cloudTop: insets.top + rs(8),
      slideDistance: winH,
    };
  }, [insets.bottom, insets.top, winH, winW]);

  useEffect(() => {
    if (slideStartedRef.current) return;
    contentSlideY.setValue(layout.slideDistance);
  }, [contentSlideY, layout.slideDistance]);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    creepRef.current?.stop();
    setPhase("exiting");
    Animated.parallel([
      Animated.timing(rootOpacity, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rootScale, {
        toValue: 1.02,
        duration: EXIT_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinish();
    });
  }, [onFinish, rootOpacity, rootScale]);

  /** Race + progress/walker run together after slide settles. */
  const startPlayingPass = useCallback(() => {
    if (loadingStartedRef.current) return;
    loadingStartedRef.current = true;
    setPhase("playing");
    setShowLoading(true);

    barProgress.stopAnimation();
    walkerProgress.stopAnimation();
    barProgress.setValue(0);
    walkerProgress.setValue(0);
    setProgressLabel(0);

    Animated.timing(loadingOpacity, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    let lastLabel = -1;
    const listener = barProgress.addListener(({ value }) => {
      const next = Math.round(value * 100);
      if (next !== lastLabel && (next === 100 || next - lastLabel >= 2)) {
        lastLabel = next;
        setProgressLabel(next);
      }
    });

    const easing = Easing.out(Easing.cubic);
    creepRef.current = Animated.parallel([
      Animated.timing(barProgress, {
        toValue: 1,
        duration: PROGRESS_DURATION_MS,
        easing,
        useNativeDriver: false,
      }),
      Animated.timing(walkerProgress, {
        toValue: 1,
        duration: PROGRESS_DURATION_MS,
        easing,
        useNativeDriver: true,
      }),
    ]);
    creepRef.current.start(({ finished }) => {
      barProgress.removeListener(listener);
      if (!finished || progressDoneRef.current) return;
      progressDoneRef.current = true;
      setProgressLabel(100);
      setProgressComplete(true);
    });
  }, [barProgress, loadingOpacity, walkerProgress]);

  const onRaceTrackComplete = useCallback(() => {
    if (raceDoneRef.current) return;
    raceDoneRef.current = true;
    setRaceComplete(true);
  }, []);

  const beginSlideUp = useCallback(() => {
    if (slideStartedRef.current) return;
    slideStartedRef.current = true;
    setPhase("sliding");
    contentSlideY.setValue(layout.slideDistance);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Animated.timing(contentSlideY, {
          toValue: 0,
          duration: SLIDE_UP_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) return;
          // Preloaded race starts here; progress/walker fill in parallel.
          startPlayingPass();
        });
      });
    });
  }, [contentSlideY, layout.slideDistance, startPlayingPass]);

  const beginIntroFade = useCallback(() => {
    if (introFadeStartedRef.current) return;
    introFadeStartedRef.current = true;
    setPhase("fading");

    Animated.parallel([
      Animated.timing(introOpacity, {
        toValue: 0,
        duration: INTRO_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fixedIconOpacity, {
        toValue: 1,
        duration: INTRO_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setShowIntroOverlay(false);
      requestAnimationFrame(() => beginSlideUp());
    });
  }, [beginSlideUp, fixedIconOpacity, introOpacity]);

  const onIntroLottieFinished = useCallback(() => {
    if (introDoneRef.current) return;
    introDoneRef.current = true;
    setTimeout(beginIntroFade, INTRO_END_BUFFER_MS);
  }, [beginIntroFade]);

  useEffect(() => {
    const t = setTimeout(onIntroLottieFinished, INTRO_DURATION_MS + 400);
    return () => clearTimeout(t);
  }, [onIntroLottieFinished]);

  useEffect(() => {
    if (!raceComplete || !progressComplete || !isReady || finishedRef.current) return;
    finish();
  }, [finish, isReady, progressComplete, raceComplete]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (finishedRef.current) return;
      if (!introFadeStartedRef.current) beginIntroFade();
      if (!slideStartedRef.current) beginSlideUp();
      if (!raceDoneRef.current) {
        raceDoneRef.current = true;
        setRaceComplete(true);
      }
      if (!progressDoneRef.current) {
        progressDoneRef.current = true;
        setProgressLabel(100);
        setProgressComplete(true);
      }
      finish();
    }, HARD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [beginIntroFade, beginSlideUp, finish]);

  const barWidth = useMemo(
    () =>
      barProgress.interpolate({
        inputRange: [0, 1],
        outputRange: ["0%", "100%"],
      }),
    [barProgress],
  );

  const walkerTravel = Math.max(0, (trackWidth || layout.progressWidth) - layout.walker);
  const walkerTranslateX = useMemo(
    () =>
      walkerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, walkerTravel],
        extrapolate: "clamp",
      }),
    [walkerProgress, walkerTravel],
  );

  const trackFallback = (
    <View style={[styles.lottie, styles.lottieFallback]}>
      <Text style={styles.fallbackStart}>START</Text>
    </View>
  );

  const racePlaying = phase === "playing" || phase === "exiting";
  const showWalker = phase === "playing" || phase === "exiting";

  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity: rootOpacity,
          transform: [{ scale: rootScale }],
        },
      ]}
      pointerEvents="auto"
    >
      <View style={styles.sky} />

      {/* Tiny on-screen host so Android actually loads race during intro. */}
      {phase === "intro" || phase === "fading" ? (
        <View style={styles.racePreloadHost} pointerEvents="none" collapsable={false}>
          <SplashErrorBoundary fallback={null}>
            <RaceTrackLottie
              style={{
                width: layout.trackWidth,
                height: Math.round(layout.trackWidth / LOTTIE_ASPECT),
              }}
              playing={false}
            />
          </SplashErrorBoundary>
        </View>
      ) : null}

      <FloatingCloud
        style={[styles.cloudA, { top: layout.cloudTop + rs(10) }]}
        driftX={10}
        driftY={4}
        duration={22000}
      />
      <FloatingCloud
        style={[styles.cloudB, { top: layout.cloudTop }]}
        driftX={-12}
        driftY={3}
        duration={26000}
        delay={800}
      />
      <FloatingCloud
        style={[styles.cloudC, { top: layout.cloudTop + rs(28) }]}
        driftX={9}
        driftY={-3}
        duration={24000}
        delay={1600}
      />

      <Animated.View
        style={[
          styles.topAppIconWrap,
          {
            top: layout.appIconTop,
            opacity: fixedIconOpacity,
            transform: [{ translateX: layout.appIconLeft }],
          },
        ]}
        pointerEvents="none"
      >
        <Image
          source={APP_ICON_IMG}
          style={{
            width: layout.appIcon,
            height: layout.appIcon,
            borderRadius: Math.round(layout.appIcon * 0.22),
          }}
          resizeMode="contain"
        />
      </Animated.View>

      {/* Slide unit: hills + branding + race only (no progress/walker). */}
      {showSlideContent ? (
        <Animated.View
          style={[styles.bottomUnit, { transform: [{ translateY: contentSlideY }] }]}
          pointerEvents="none"
        >
          <View style={styles.hillBack} />
          <View style={styles.hillFront} />
          <View style={[styles.bush, styles.bushL]} />
          <View style={[styles.bush, styles.bushR]} />
          <View style={styles.grassA} />
          <View style={styles.grassB} />
          <View style={styles.flower} />

          <View
            style={[
              styles.content,
              {
                paddingTop: layout.padTop,
                marginBottom: layout.progressBottom + layout.walker + layout.barH + rv(28),
              },
            ]}
          >
            <View style={styles.heroBlock}>
              <Text style={[styles.title, { fontSize: layout.titleSize }]}>
                <Text style={styles.titleDark}>Walk </Text>
                <Text style={styles.titleGreen}>Champ</Text>
              </Text>
              <View style={styles.tagRow}>
                <View style={styles.tagRule} />
                <Text style={styles.tagline}>Fun races. Real connections.</Text>
                <View style={styles.tagRule} />
              </View>

              <View style={[styles.trackCard, { width: layout.trackWidth }]}>
                <View style={styles.lottieStage}>
                  <SplashErrorBoundary fallback={trackFallback}>
                    {/* Preloaded from intro (off-screen); plays only after slide settles. */}
                    <RaceTrackLottie
                      style={styles.lottie}
                      playing={racePlaying}
                      onComplete={onRaceTrackComplete}
                    />
                  </SplashErrorBoundary>
                </View>
              </View>

              <View style={styles.flag}>
                <View style={styles.flagPole} />
                <View style={styles.flagCloth}>
                  {[0, 1, 2].map((row) => (
                    <View key={row} style={styles.flagRow}>
                      {[0, 1, 2, 3].map((col) => (
                        <View
                          key={col}
                          style={[
                            styles.flagCell,
                            (row + col) % 2 === 0 ? styles.flagDark : styles.flagLight,
                          ]}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              </View>

              <Text style={styles.loadingText}>Getting ready for an awesome race...</Text>
            </View>
          </View>
        </Animated.View>
      ) : null}

      {/*
        Progress + walker — fixed layer (pre-slide loading behavior).
        Not part of the slide transform, so no hitch mid-rise.
      */}
      {showLoading ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.progressWrap,
            {
              bottom: layout.progressBottom,
              paddingHorizontal: rs(28),
              opacity: loadingOpacity,
            },
          ]}
        >
          <View style={[styles.progressInner, { width: layout.progressWidth }]}>
            <View
              style={[
                styles.walkerBarStage,
                {
                  width: "100%",
                  height: layout.walker + layout.walkerBarGap + layout.barH,
                },
              ]}
              onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                if (w > 0 && w !== trackWidth) setTrackWidth(w);
              }}
            >
              <View
                style={[
                  styles.progressTrack,
                  {
                    height: layout.barH,
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                  },
                ]}
              >
                <Animated.View style={[styles.progressFill, { width: barWidth }]} />
              </View>
              <Animated.View
                collapsable={false}
                pointerEvents="none"
                style={[
                  styles.walkerFrame,
                  {
                    width: layout.walker,
                    height: layout.walker,
                    position: "absolute",
                    left: 0,
                    bottom: layout.barH + layout.walkerBarGap,
                    transform: [{ translateX: walkerTranslateX }],
                  },
                ]}
              >
                <SplashErrorBoundary fallback={null}>
                  {showWalker ? (
                    <WalkingLottie
                      style={{
                        width: layout.walker,
                        height: layout.walker,
                      }}
                    />
                  ) : null}
                </SplashErrorBoundary>
              </Animated.View>
            </View>
            <Text style={styles.progressPct}>{progressLabel}%</Text>
          </View>
        </Animated.View>
      ) : null}

      {showIntroOverlay ? (
        <Animated.View
          pointerEvents={phase === "intro" ? "auto" : "none"}
          style={[styles.introOverlay, { opacity: introOpacity }]}
        >
          <SplashErrorBoundary fallback={null}>
            <SplashAppIconIntroLottie onFinished={onIntroLottieFinished} />
          </SplashErrorBoundary>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    backgroundColor: BG,
    overflow: "hidden",
  },
  sky: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
  },
  bottomUnit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  racePreloadHost: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 2,
    height: 2,
    opacity: 0,
    overflow: "hidden",
    zIndex: 0,
  },
  cloudImg: {
    position: "absolute",
    zIndex: 20,
  },
  cloudA: {
    top: rs(48),
    left: rs(12),
    width: rs(92),
    height: rs(52),
    opacity: 0.95,
    zIndex: 20,
  },
  cloudB: {
    top: rs(36),
    right: rs(18),
    width: rs(78),
    height: rs(44),
    opacity: 0.9,
    zIndex: 20,
  },
  cloudC: {
    top: rs(72),
    right: rs(78),
    width: rs(58),
    height: rs(34),
    opacity: 0.85,
    zIndex: 20,
  },
  hillBack: {
    position: "absolute",
    bottom: -rs(40),
    left: -rs(40),
    right: -rs(40),
    height: rs(180),
    borderTopLeftRadius: rs(180),
    borderTopRightRadius: rs(180),
    backgroundColor: HILL,
    zIndex: 0,
  },
  hillFront: {
    position: "absolute",
    bottom: -rs(70),
    left: -rs(80),
    width: "70%",
    height: rs(160),
    borderTopRightRadius: rs(160),
    backgroundColor: HILL_DARK,
    zIndex: 0,
  },
  bush: {
    position: "absolute",
    backgroundColor: BUSH,
    borderRadius: 999,
    zIndex: 0,
  },
  bushL: { bottom: rs(70), left: rs(18), width: rs(54), height: rs(36) },
  bushR: { bottom: rs(58), right: rs(22), width: rs(62), height: rs(40) },
  grassA: {
    position: "absolute",
    bottom: rs(118),
    left: rs(110),
    width: rs(10),
    height: rs(16),
    borderRadius: 4,
    backgroundColor: "#6FBF6A",
    transform: [{ rotate: "-18deg" }],
    zIndex: 0,
  },
  grassB: {
    position: "absolute",
    bottom: rs(112),
    right: rs(128),
    width: rs(10),
    height: rs(16),
    borderRadius: 4,
    backgroundColor: "#6FBF6A",
    transform: [{ rotate: "16deg" }],
    zIndex: 0,
  },
  flower: {
    position: "absolute",
    bottom: rs(124),
    right: rs(150),
    width: rs(8),
    height: rs(8),
    borderRadius: 4,
    backgroundColor: "#F4A4C0",
    zIndex: 0,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: rs(28),
    width: "100%",
    zIndex: 1,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  topAppIconWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 18,
    elevation: 18,
  },
  heroBlock: {
    width: "100%",
    alignItems: "center",
    zIndex: 1,
    backgroundColor: "transparent",
  },
  title: {
    fontWeight: "900",
    letterSpacing: -1,
    marginBottom: rv(6),
    textAlign: "center",
  },
  titleDark: { color: TITLE },
  titleGreen: { color: TITLE_ACCENT },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: rv(22),
  },
  tagRule: {
    width: rs(18),
    height: 2,
    borderRadius: 1,
    backgroundColor: TITLE_ACCENT,
    opacity: 0.7,
  },
  tagline: {
    fontSize: rf(15),
    fontWeight: "600",
    color: MUTED,
  },
  trackCard: {
    maxWidth: "100%",
    aspectRatio: LOTTIE_ASPECT,
    borderRadius: rs(24),
    overflow: "hidden",
    borderWidth: 4,
    borderColor: TRACK_BORDER,
    backgroundColor: "#D9DEE3",
    shadowColor: "#1B3A1C",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 0,
    alignSelf: "center",
  },
  lottieStage: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  lottie: {
    width: "100%",
    height: "100%",
  },
  lottieFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9AA3AB",
  },
  fallbackStart: {
    color: "#FFF",
    fontSize: rf(34),
    fontWeight: "900",
    letterSpacing: 2,
  },
  flag: {
    marginTop: rv(18),
    flexDirection: "row",
    alignItems: "flex-start",
    height: rs(28),
  },
  flagPole: {
    width: 3,
    height: rs(28),
    backgroundColor: "#3D8B40",
    borderRadius: 2,
  },
  flagCloth: {
    marginLeft: 2,
    borderWidth: 1,
    borderColor: "#2F3A33",
    overflow: "hidden",
  },
  flagRow: { flexDirection: "row" },
  flagCell: { width: rs(7), height: rs(7) },
  flagDark: { backgroundColor: "#2F3A33" },
  flagLight: { backgroundColor: "#FFFFFF" },
  loadingText: {
    marginTop: rv(10),
    marginBottom: 0,
    fontSize: rf(14),
    fontWeight: "600",
    color: MUTED,
    textAlign: "center",
    paddingHorizontal: rs(12),
    backgroundColor: "transparent",
  },
  progressWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 200,
    overflow: "visible",
  },
  progressInner: {
    maxWidth: "100%",
    alignItems: "center",
    overflow: "visible",
    backgroundColor: "transparent",
  },
  walkerBarStage: {
    width: "100%",
    position: "relative",
    overflow: "visible",
  },
  walkerFrame: {
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "visible",
    backgroundColor: "transparent",
    zIndex: 2,
  },
  progressTrack: {
    width: "100%",
    borderRadius: rs(8),
    backgroundColor: BAR_TRACK,
    overflow: "hidden",
    zIndex: 1,
  },
  progressFill: {
    height: "100%",
    borderRadius: rs(8),
    backgroundColor: BAR_FILL,
  },
  progressPct: {
    marginTop: 4,
    fontSize: rf(12),
    fontWeight: "700",
    color: TITLE_ACCENT,
    minHeight: rf(14),
  },
  introOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 8,
    elevation: 8,
    backgroundColor: BG,
  },
  introLottie: {
    ...StyleSheet.absoluteFillObject,
  },
});
