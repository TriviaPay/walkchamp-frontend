/**
 * Release-safe performance instrumentation.
 * Counters always update (tiny CPU cost); console output is __DEV__-only.
 * Never log tokens, PII, payment details, or health payloads.
 */

const appStartMs = Date.now();
const screenMountMs = new Map<string, number>();
const screenFocusMs = new Map<string, number>();
const navStartMs = { current: 0, from: "" };

const counters = {
  apiRequests: 0,
  duplicateBlocked: 0,
  secureStoreReads: 0,
  secureStoreCacheHits: 0,
  activeTimers: 0,
  activeSubscriptions: 0,
  renders: new Map<string, number>(),
};

function log(message: string): void {
  if (__DEV__) console.log(message);
}

function bumpRender(component: string): number {
  const n = (counters.renders.get(component) ?? 0) + 1;
  counters.renders.set(component, n);
  return n;
}

export const perf = {
  appStartStart(): void {
    log(`[Perf] appColdStartMs=0 (mark) elapsedSinceProcess=${Date.now() - appStartMs}`);
  },

  authRestore(ms: number): void {
    log(`[Perf] AuthRestore ms=${ms}`);
  },

  initialRouteReady(ms: number): void {
    log(`[Perf] firstMeaningfulRenderMs=${ms} (InitialRouteReady)`);
  },

  appStartupReady(): void {
    log(`[Perf] appStartupReadyMs=${Date.now() - appStartMs}`);
  },

  screenMount(screen: string): void {
    screenMountMs.set(screen, Date.now());
    log(`[Perf] ScreenMount screen=${screen} sinceAppStartMs=${Date.now() - appStartMs}`);
  },

  screenFocus(screen: string): void {
    screenFocusMs.set(screen, Date.now());
    log(`[Perf] ScreenFocus screen=${screen}`);
  },

  firstContentfulRender(screen: string): void {
    const started = screenMountMs.get(screen) ?? screenFocusMs.get(screen);
    const ms = started ? Date.now() - started : 0;
    log(`[Perf] firstMeaningfulRenderMs=${ms} screen=${screen}`);
  },

  focusToContent(screen: string): void {
    const started = screenFocusMs.get(screen);
    const ms = started ? Date.now() - started : 0;
    log(`[Perf] screen=${screen} focusToContentMs=${ms}`);
  },

  apiRequest(name: string, key: string, ms: number): void {
    counters.apiRequests += 1;
    log(`[Perf] apiRequestCount=${counters.apiRequests} name=${name} key=${key} ms=${ms}`);
  },

  apiDeduped(name: string): void {
    counters.duplicateBlocked += 1;
    log(`[Perf] duplicateRequestSkipped key=${name}`);
  },

  apiSkipped(reason: string): void {
    log(`[Perf] API skipped reason=${reason}`);
  },

  cacheHit(key: string): void {
    log(`[Perf] Cache hit key=${key}`);
  },

  cacheMiss(key: string): void {
    log(`[Perf] Cache miss key=${key}`);
  },

  backgroundRefresh(screen: string): void {
    log(`[Perf] BackgroundRefresh screen=${screen}`);
  },

  navigation(screenFrom: string, screenTo: string, ms: number): void {
    log(`[Perf] Navigation screenFrom=${screenFrom} screenTo=${screenTo} ms=${ms}`);
  },

  navigationStart(screenFrom: string, screenTo: string): void {
    navStartMs.current = Date.now();
    navStartMs.from = screenFrom;
    log(`[Perf] Navigation start screenFrom=${screenFrom} screenTo=${screenTo}`);
  },

  navigationEnd(screenTo: string): void {
    const ms = navStartMs.current ? Date.now() - navStartMs.current : 0;
    log(`[Perf] Navigation screenFrom=${navStartMs.from} screenTo=${screenTo} ms=${ms}`);
    navStartMs.current = 0;
  },

  modalOpen(name: string, ms: number): void {
    log(`[Perf] ModalOpen name=${name} ms=${ms}`);
  },

  slowRender(component: string, ms: number): void {
    if (ms >= 16) log(`[Perf] SlowRender component=${component} ms=${ms}`);
  },

  componentRender(component: string): void {
    const n = bumpRender(component);
    if (n === 1 || n % 30 === 0) {
      log(`[Perf] component=${component} renderCount=${n}`);
    }
  },

  realtimeEvent(type: string, applied: boolean): void {
    log(`[Perf] RealtimeEvent type=${type} applied=${applied}`);
  },

  duplicateRequestBlocked(key: string): void {
    counters.duplicateBlocked += 1;
    log(`[Perf] DuplicateRequest blocked key=${key}`);
  },

  secureStoreRead(source: "disk" | "memory"): void {
    if (source === "disk") {
      counters.secureStoreReads += 1;
      log(`[Perf] secureStoreReadCount=${counters.secureStoreReads} source=disk`);
    } else {
      counters.secureStoreCacheHits += 1;
      if (counters.secureStoreCacheHits === 1 || counters.secureStoreCacheHits % 50 === 0) {
        log(
          `[Perf] secureStoreCacheHits=${counters.secureStoreCacheHits} diskReads=${counters.secureStoreReads}`,
        );
      }
    }
  },

  timerRegistered(delta: 1 | -1): void {
    counters.activeTimers = Math.max(0, counters.activeTimers + delta);
    if (__DEV__ && (delta === 1 || counters.activeTimers % 5 === 0)) {
      log(`[Perf] activeTimers=${counters.activeTimers}`);
    }
  },

  subscriptionRegistered(delta: 1 | -1): void {
    counters.activeSubscriptions = Math.max(0, counters.activeSubscriptions + delta);
    if (__DEV__ && (delta === 1 || counters.activeSubscriptions % 3 === 0)) {
      log(`[Perf] activeSubscriptions=${counters.activeSubscriptions}`);
    }
  },

  pusherConnected(connected: boolean): void {
    log(`[Perf] pusherConnected=${connected}`);
  },

  fallbackPollTriggered(reason: string): void {
    log(`[Perf] fallbackPollTriggered=true reason=${reason}`);
  },

  imageTheme(action: string, themeId: string): void {
    log(`[Perf] imageTheme action=${action} themeId=${themeId}`);
  },

  snapshot(): {
    apiRequests: number;
    duplicateBlocked: number;
    secureStoreReads: number;
    secureStoreCacheHits: number;
    activeTimers: number;
    activeSubscriptions: number;
    elapsedSinceAppStart: number;
  } {
    return {
      apiRequests: counters.apiRequests,
      duplicateBlocked: counters.duplicateBlocked,
      secureStoreReads: counters.secureStoreReads,
      secureStoreCacheHits: counters.secureStoreCacheHits,
      activeTimers: counters.activeTimers,
      activeSubscriptions: counters.activeSubscriptions,
      elapsedSinceAppStart: Date.now() - appStartMs,
    };
  },

  elapsedSinceAppStart(): number {
    return Date.now() - appStartMs;
  },
};

/** Wrap an async API call with timing + optional dedup logging. */
export async function timedApiCall<T>(
  name: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    perf.apiRequest(name, key, Date.now() - start);
  }
}
