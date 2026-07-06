import { useEffect, useRef } from "react";
import { perf } from "@/utils/perfLogger";

/**
 * Log screen mount and first-contentful-render timing.
 * Call markContentReady() once critical data is visible (not on every re-render).
 */
export function useScreenMountPerf(screenName: string) {
  const markedRef = useRef(false);

  useEffect(() => {
    perf.screenMount(screenName);
    return () => {
      markedRef.current = false;
    };
  }, [screenName]);

  const markContentReady = () => {
    if (markedRef.current) return;
    markedRef.current = true;
    perf.firstContentfulRender(screenName);
  };

  return { markContentReady };
}
