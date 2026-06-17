import { useEffect } from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import { useAppDispatch } from "@/store/hooks";
import { setCoinBalance, addEarnedCoins } from "@/store/slices/coinsSlice";
import {
  subscribeToChannel,
  unsubscribeFromChannel,
} from "@/services/realtimeService";

type WalletUpdatedPayload = {
  type?: string;
  coinBalance?: number;
  coins?: number;
  changeAmount?: number;
  description?: string;
};

type CoinsEarnedPayload = {
  coins?: number;
  coinBalance?: number;
  description?: string;
  rewardCode?: string;
};

/**
 * Null component — renders nothing but subscribes to the user's private Pusher
 * channel and keeps the Redux coin balance in sync with backend truth in real-time.
 *
 * Must be placed inside ReduxProvider + AuthProvider (i.e. inside the GestureHandlerRootView).
 */
export function CoinRealtimeSync() {
  const dispatch = useAppDispatch();
  const userId = useSelector((s: RootState) => s.auth.user?.id);

  useEffect(() => {
    if (!userId) return;

    const channelName = `private-user-${userId}`;
    const channel = subscribeToChannel(channelName);
    if (!channel) return;

    const onWalletUpdated = (data: WalletUpdatedPayload) => {
      if (typeof data.coinBalance === "number") {
        // Authoritative balance from backend — set it exactly to avoid drift
        dispatch(setCoinBalance(data.coinBalance));
      } else if (typeof data.coins === "number" && typeof data.changeAmount === "number" && data.changeAmount > 0) {
        dispatch(addEarnedCoins({ amount: data.coins }));
      }
    };

    const onCoinsEarned = (data: CoinsEarnedPayload) => {
      if (typeof data.coinBalance === "number") {
        dispatch(setCoinBalance(data.coinBalance));
      } else if (typeof data.coins === "number") {
        dispatch(addEarnedCoins({ amount: data.coins }));
      }
    };

    channel.bind("wallet.updated", onWalletUpdated);
    channel.bind("coins:earned", onCoinsEarned);

    return () => {
      channel.unbind("wallet.updated", onWalletUpdated);
      channel.unbind("coins:earned", onCoinsEarned);
      unsubscribeFromChannel(channelName);
    };
  }, [userId, dispatch]);

  return null;
}
