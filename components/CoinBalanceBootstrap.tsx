/**
 * Hydrates THIS user's coin balance from disk, wipes previous account instantly
 * on switch, then refreshes from API — never shows another user's coins.
 */
import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store";
import { useAppDispatch } from "@/store/hooks";
import {
  fetchCoinBalance,
  hydrateCoinBalance,
  resetCoinBalance,
} from "@/store/slices/coinsSlice";
import {
  clearCachedCoinBalance,
  loadCachedCoinBalance,
  persistCoinBalance,
} from "@/utils/coinBalanceCache";
import { fetchTrackThemes } from "@/store/slices/trackThemesSlice";

export function CoinBalanceBootstrap() {
  const dispatch = useAppDispatch();
  const userId = useSelector((s: RootState) => s.auth.user?.id ?? null);
  const authLoading = useSelector((s: RootState) => s.auth.isLoading);
  const balance = useSelector((s: RootState) => s.coins.balance);
  const prevUserIdRef = useRef<string | null>(null);
  const fetchGenRef = useRef(0);

  // Account switch / login / logout — wipe old coins immediately, then seed + fetch for new user.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    const switched = prev !== null && userId !== null && prev !== userId;
    const loggedOut = prev !== null && userId === null;

    prevUserIdRef.current = userId;

    if (authLoading && !userId) return;

    if (switched || loggedOut) {
      // Never leave the previous account's balance on screen.
      dispatch(resetCoinBalance());
    }

    if (loggedOut || !userId) {
      clearCachedCoinBalance();
      return;
    }

    const gen = ++fetchGenRef.current;
    let cancelled = false;

    // Instant: only this user's disk cache (miss → show "—" until network).
    void loadCachedCoinBalance(userId).then((cached) => {
      if (cancelled || gen !== fetchGenRef.current) return;
      if (cached) dispatch(hydrateCoinBalance(cached));
    });

    // Immediate network refresh for the active account.
    void dispatch(fetchCoinBalance());
    void dispatch(fetchTrackThemes());

    return () => {
      cancelled = true;
    };
  }, [userId, authLoading, dispatch]);

  // Persist only under the active userId.
  useEffect(() => {
    if (userId && balance) persistCoinBalance(userId, balance);
  }, [userId, balance]);

  return null;
}
