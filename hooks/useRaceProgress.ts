import { useSelector } from "react-redux";
import type { RootState } from "@/store";

/** Read-only hook — canonical live race + daily step progress. */
export function useRaceProgress() {
  return useSelector((state: RootState) => state.raceProgress);
}
