/**
 * Release-safe performance instrumentation.
 * Logs are gated behind __DEV__ — zero overhead in production builds.
 */

const appStartMs = Date.now();
const screenMountMs = new Map<string, number>();
const navStartMs = { current: 0, from: "" };

function log(message: string): void {
  if (__DEV__) console.log(message);
}

export const perf = {
  appStartStart(): void {
    log("[Perf] AppStart start");
  },

  authRestore(ms: number): void {
    log(`[Perf] AuthRestore ms=${ms}`);
  },

  initialRouteReady(ms: number): void {
    log(`[Perf] InitialRouteReady ms=${ms}`);
  },

  screenMount(screen: string): void {
    screenMountMs.set(screen, Date.now());
    log(`[Perf] ScreenMount screen=${screen} time=${Date.now() - appStartMs}`);
  },

  firstContentfulRender(screen: string): void {
    const started = screenMountMs.get(screen);
    const ms = started ? Date.now() - started : 0;
    log(`[Perf] FirstContentfulRender screen=${screen} ms=${ms}`);
  },

  apiRequest(name: string, key: string, ms: number): void {
    log(`[Perf] API request name=${name} key=${key} ms=${ms}`);
  },

  apiDeduped(name: string): void {
    log(`[Perf] API deduped name=${name}`);
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

  realtimeEvent(type: string, applied: boolean): void {
    log(`[Perf] RealtimeEvent type=${type} applied=${applied}`);
  },

  duplicateRequestBlocked(key: string): void {
    log(`[Perf] DuplicateRequest blocked key=${key}`);
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
