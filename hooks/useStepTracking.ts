import { useCallback, useEffect, useState } from "react";
import { stepTracker, PermissionStatus } from "@/services/StepTrackingService";

export interface UseStepTrackingResult {
  permissionStatus: PermissionStatus;
  isAvailable: boolean;
  isLoading: boolean;
  requestPermission: () => Promise<PermissionStatus>;
  getStepsForTimeRange: (start: Date, end: Date) => Promise<number | null>;
}

export function useStepTracking(): UseStepTrackingResult {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>("unknown");
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const available = await stepTracker.isAvailable();
      if (cancelled) return;
      setIsAvailable(available);
      if (available) {
        const status = await stepTracker.getPermissionStatus();
        if (!cancelled) setPermissionStatus(status);
      } else {
        if (!cancelled) setPermissionStatus("unavailable");
      }
      if (!cancelled) setIsLoading(false);
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    const status = await stepTracker.requestPermission();
    setPermissionStatus(status);
    return status;
  }, []);

  const getStepsForTimeRange = useCallback(async (start: Date, end: Date): Promise<number | null> => {
    const data = await stepTracker.getStepsForTimeRange(start, end);
    return data?.steps ?? null;
  }, []);

  return { permissionStatus, isAvailable, isLoading, requestPermission, getStepsForTimeRange };
}
