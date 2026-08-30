/**
 * Guard transactional UI actions when offline.
 */
import { useCallback } from "react";
import { useNetwork } from "@/context/NetworkContext";

export function useRequireOnlineAction(defaultMessage?: string) {
  const { requireOnline } = useNetwork();
  return useCallback(
    (action?: () => void, message?: string): boolean => {
      if (!requireOnline(message ?? defaultMessage)) return false;
      action?.();
      return true;
    },
    [requireOnline, defaultMessage],
  );
}
