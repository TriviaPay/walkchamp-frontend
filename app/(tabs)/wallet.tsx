import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { useScreenMountPerf } from "@/hooks/useScreenMountPerf";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AppStateStatus,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { AppAlert } from "@/components/AppAlert";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useNetwork } from "@/context/NetworkContext";
import { canStartCashPaymentFlow } from "@/config/featureFlags";
import { isPaymentsLiveMode } from "@/config/env";
import { formatCurrency, formatWalletAmount } from "@/utils/format";
import { rf, rs } from "@/utils/responsive";
import type { WalletTransaction } from "@/utils/mockData";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { authFetch } from "@/utils/authFetch";
import { PAYMENT_DEEP_LINK_SCHEME, DEPOSIT_POLL_FIRST_MS, DEPOSIT_POLL_INTERVAL_MS } from "@/config/paymentsConfig";
import {
  clearPendingDeposit,
  consumePaymentResult,
  depositStatusToUiResult,
  fetchDepositStatus,
  isPollCompleteDepositStatus,
  isTerminalDepositStatus,
  resolveDepositUiFromTransaction,
  resolvePendingDepositOnResume,
  savePendingDeposit,
  type PaymentResultStatus,
} from "@/services/depositSession";
import { ledgerTypeLabel } from "@/utils/walletLedger";
import { readPaymentApiError } from "@/utils/paymentApiErrors";

const PAYOUT_METHODS = ["PayPal", "Bank Transfer", "UPI (India)", "Gift Card"];
const MIN_WITHDRAWAL = 5;

const PAYMENT_RESULT_PRIORITY: Record<PaymentResultStatus, number> = {
  success: 4,
  cancelled: 3,
  verification_failed: 2,
  failed: 1,
};

const REFERRAL_ART = require("../../assets/images/referal.png");

const EARN_CARDS = [
  {
    icon: "flag" as const,
    title: "Cash Challenges",
    reward: "Win Cash Prizes",
    sub: "Finish Top 3 to win your share of the prize pool.",
    color: "#00E676",
    fullWidth: false,
    glow: "bottomLeft" as const,
  },
  {
    icon: "gift" as const,
    title: "Sponsored Events",
    reward: "$5 Amazon gift card",
    sub: "Available during sponsored events",
    color: "#FF6B35",
    fullWidth: false,
    glow: "bottomRight" as const,
  },
  {
    icon: "users" as const,
    title: "Referral",
    reward: "Both Get $3",
    sub: "Invite friends. They join a Cash Challenge—you both earn $3.",
    color: "#00B4FF",
    fullWidth: true,
    glow: "center" as const,
    showArt: true,
  },
];

// Preset amounts shown as chips — tapping one fires the payment immediately
const STRIPE_PRESETS = [
  { label: "$1",  cents: 100 },
  { label: "$3",  cents: 300 },
  { label: "$5",  cents: 500 },
];
const RAZORPAY_PRESETS = [
  { label: "₹100", paise: 10000 },
  { label: "₹300", paise: 30000 },
  { label: "₹500", paise: 50000 },
];

type DepositProvider = "stripe" | "razorpay";
type DepositStatus = "idle" | "creating" | "open" | "verifying" | "success" | "failed" | "cancelled";
type PaymentResultState = "hidden" | "verifying" | "success" | "failed" | "cancelled" | "verification_failed";

function TransactionRow({
  tx,
  colors,
}: {
  tx: WalletTransaction;
  colors: ReturnType<typeof useColors>;
}) {
  const isCredit = tx.amount > 0;
  const icons: Record<WalletTransaction["type"], string> = {
    reward: "award",
    withdrawal: "arrow-up-right",
    bonus: "gift",
    referral: "users",
    deposit: "arrow-down-left",
    challenge_entry: "flag",
    prize: "award",
    refund: "rotate-ccw",
    reversal: "alert-circle",
  };
  const typeBadge = ledgerTypeLabel(tx.ledgerType);
  const statusColors: Record<WalletTransaction["status"], string> = {
    completed: colors.success,
    pending: colors.warning,
    rejected: colors.destructive,
  };

  return (
    <View style={[styles.txRow, { borderBottomColor: colors.border }]}>
      <View
        style={[
          styles.txIcon,
          {
            backgroundColor:
              (isCredit ? colors.success : colors.destructive) + "18",
          },
        ]}
      >
        <Feather
          name={icons[tx.type] as never}
          size={16}
          color={isCredit ? colors.success : colors.destructive}
        />
      </View>
      <View style={styles.txInfo}>
        <Text
          style={[styles.txDesc, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {tx.description}
        </Text>
        {typeBadge ? (
          <Text style={[styles.txLedgerBadge, { color: colors.mutedForeground }]}>
            {typeBadge}
          </Text>
        ) : null}
        <View style={styles.txMeta}>
          <Text style={[styles.txDate, { color: colors.mutedForeground }]}>
            {tx.date}
          </Text>
          <View
            style={[
              styles.txStatusChip,
              { backgroundColor: statusColors[tx.status] + "18" },
            ]}
          >
            <Text
              style={[
                styles.txStatusText,
                { color: statusColors[tx.status] },
              ]}
            >
              {tx.status}
            </Text>
          </View>
        </View>
      </View>
      <Text
        style={[
          styles.txAmount,
          { color: isCredit ? colors.success : colors.destructive },
        ]}
      >
        {isCredit ? "+" : ""}
        {formatCurrency(Math.abs(tx.amount))}
      </Text>
    </View>
  );
}

export default function WalletScreen() {
  useScreenMountPerf("Wallet");
  const router = useRouter();
  const params = useLocalSearchParams<{ openDeposit?: string }>();
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { walletBalance, pendingBalance, walletCurrency, transactions, requestWithdrawal, refreshWallet } =
    useApp();
  const { user } = useAuth();
  const { requireOnline } = useNetwork();

  // Silent background refresh when wallet tab is focused (cached data stays visible).
  useFocusEffect(
    useCallback(() => {
      if (!apiFetchAllowed("wallet_tab_focus", 60_000)) return;
      markApiFetched("wallet_tab_focus");
      void refreshWallet({ silent: true });
    }, [refreshWallet]),
  );

  // ── Country / provider logic ──────────────────────────────────────────────
  const userCountryCode = user?.countryCode ?? null;
  const userCountry = user?.country ?? null;
  const hasCountry = !!(userCountryCode || userCountry);
  const isIndia =
    userCountryCode === "IN" ||
    userCountry?.toLowerCase() === "india";

  // Provider is fixed by country — no switcher shown to the user
  const depositProvider: DepositProvider = isIndia ? "razorpay" : "stripe";

  // Currency for balance display: derive from country so new users see the
  // correct symbol even before their first deposit (DB default is "USD").
  const displayCurrency = hasCountry ? (isIndia ? "INR" : "USD") : walletCurrency;

  if (__DEV__) console.log("[WalletCurrency] user country:", userCountryCode, "| selected provider:", depositProvider, "| wallet currency:", displayCurrency);

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(PAYOUT_METHODS[0]);
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const availableBalance = walletBalance;
  const withdrawableBalance = Math.max(0, walletBalance - pendingBalance);
  const totalEarned = transactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const canWithdraw = withdrawableBalance >= MIN_WITHDRAWAL;

  const [withdrawing, setWithdrawing] = useState(false);
  const [payoutEmail, setPayoutEmail] = useState("");

  // ── Deposit state ─────────────────────────────────────────────────────────
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositStatus, setDepositStatus] = useState<DepositStatus>("idle");
  const [depositAmountStr, setDepositAmountStr] = useState("");
  const [depositError, setDepositError] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<{ label: string; cents?: number; paise?: number } | null>(null);
  const processingRef = useRef(false);
  const appliedPaymentResultRef = useRef<string | null>(null);
  const paymentResultDismissedRef = useRef(false);

  // Deep-link / alert CTA: open deposit sheet when navigated with openDeposit=1
  useEffect(() => {
    const flag = Array.isArray(params.openDeposit) ? params.openDeposit[0] : params.openDeposit;
    if (flag === "1" || flag === "true") {
      setShowDeposit(true);
      router.setParams({ openDeposit: undefined });
    }
  }, [params.openDeposit, router]);

  // ── Payment result modal state ─────────────────────────────────────────────
  const [paymentResult, setPaymentResult] = useState<PaymentResultState>("hidden");

  const tabBarHeight = useTabBarHeight();

  const handleWithdraw = async () => {
    if (!requireOnline("Reconnect to request a withdrawal.")) return;
    if (!canStartCashPaymentFlow()) {
      AppAlert.alert(
        "Withdrawals unavailable",
        isPaymentsLiveMode()
          ? "Cash withdrawals are disabled until live payment keys and real-money approvals are configured."
          : "Cash withdrawals are disabled in this build. Enable cash features on the API, or set EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=true.",
      );
      return;
    }
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount < MIN_WITHDRAWAL) {
      AppAlert.alert(
        "Minimum Withdrawal",
        `Minimum withdrawal amount is ${formatCurrency(MIN_WITHDRAWAL)}.`,
      );
      return;
    }
    if (amount > withdrawableBalance) {
      AppAlert.alert(
        "Insufficient Balance",
        `Your withdrawable balance is ${formatCurrency(withdrawableBalance)}.`,
      );
      return;
    }
    setWithdrawing(true);
    try {
      const payoutDetails: Record<string, string> = {};
      if (payoutEmail.trim()) payoutDetails.email = payoutEmail.trim();

      await requestWithdrawal(amount, selectedMethod, payoutDetails);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowWithdraw(false);
      setWithdrawAmount("");
      setPayoutEmail("");
      AppAlert.alert(
        "Withdrawal Requested",
        "Your request has been submitted for admin review. Processing takes 1–3 business days.\n\nStatus: Pending",
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Request failed. Please try again.";
      AppAlert.alert("Withdrawal Failed", msg);
    } finally {
      setWithdrawing(false);
    }
  };

  // ── Deposit helpers ───────────────────────────────────────────────────────
  const resetDeposit = () => {
    setDepositStatus("idle");
    setDepositError("");
    setDepositAmountStr("");
    setCustomMode(false);
    setSelectedPreset(null);
    processingRef.current = false;
  };

  const closeDeposit = () => {
    setShowDeposit(false);
    resetDeposit();
  };

  const closePaymentResult = () => {
    if (paymentResultDismissedRef.current) return;
    paymentResultDismissedRef.current = true;
    setPaymentResult("hidden");
  };

  const applyPaymentResult = useCallback((ui: PaymentResultStatus, transactionId?: string) => {
    if (paymentResultDismissedRef.current) return;

    const dedupeKey = transactionId ? `${transactionId}:${ui}` : ui;
    if (appliedPaymentResultRef.current === dedupeKey) return;

    const prevKey = appliedPaymentResultRef.current;
    if (prevKey) {
      const prevUi = (
        prevKey.includes(":") ? prevKey.split(":")[1] : prevKey
      ) as PaymentResultStatus;
      if ((PAYMENT_RESULT_PRIORITY[prevUi] ?? 0) > (PAYMENT_RESULT_PRIORITY[ui] ?? 0)) return;
    }

    appliedPaymentResultRef.current = dedupeKey;

    router.replace("/(tabs)/wallet");

    if (ui === "success") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPaymentResult("success");
      void refreshWallet().catch(() => {});
      return;
    }
    if (ui === "cancelled") {
      setPaymentResult("cancelled");
      return;
    }
    if (ui === "verification_failed") {
      setPaymentResult("verification_failed");
      void refreshWallet().catch(() => {});
      return;
    }
    setPaymentResult("failed");
    void refreshWallet().catch(() => {});
  }, [refreshWallet, router]);

  // Show result saved by Universal Link / payment return handler.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (paymentResultDismissedRef.current) return;
        const stored = await consumePaymentResult();
        if (stored) {
          applyPaymentResult(stored.status, stored.transactionId);
        }
      })();
    }, [applyPaymentResult]),
  );

  // Poll pending deposit when app returns to foreground (Phase C).
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== "active") return;
      void (async () => {
        if (paymentResultDismissedRef.current || appliedPaymentResultRef.current) {
          await refreshWallet({ silent: true }).catch(() => {});
          return;
        }
        const resolved = await resolvePendingDepositOnResume();
        if (resolved) {
          applyPaymentResult(resolved.status, resolved.transactionId);
        } else {
          await refreshWallet({ silent: true }).catch(() => {});
        }
      })();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [applyPaymentResult, refreshWallet]);

  // Pay button fires this — uses selectedPreset or custom text input
  const handleDeposit = async () => {
    if (processingRef.current) return;
    if (!requireOnline("Reconnect to make a deposit.")) return;
    if (!canStartCashPaymentFlow()) {
      setDepositError(
        isPaymentsLiveMode()
          ? "Deposits are disabled until live payment keys are configured for this build."
          : "Deposits are disabled. Set EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=true and ensure the API has cash features enabled (sandbox keys OK when PAYMENTS_LIVE_MODE=false).",
      );
      return;
    }

    let checkoutCents = 0;
    let checkoutPaise = 0;

    if (selectedPreset) {
      if (depositProvider === "stripe" && selectedPreset.cents !== undefined) {
        checkoutCents = selectedPreset.cents;
      } else if (depositProvider === "razorpay" && selectedPreset.paise !== undefined) {
        checkoutPaise = selectedPreset.paise;
      }
    } else if (customMode) {
      const rawAmount = depositAmountStr.trim();
      if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
        setDepositError("Please enter a valid amount.");
        return;
      }
      const amount = Number(rawAmount);
      if (depositProvider === "stripe") {
        checkoutCents = Math.round(amount * 100);
        if (checkoutCents < 100) { setDepositError("Minimum deposit is $1.00."); return; }
        if (checkoutCents > 50000) { setDepositError("Maximum deposit is $500.00."); return; }
      } else {
        checkoutPaise = Math.round(amount * 100);
        if (checkoutPaise < 1000) { setDepositError("Minimum deposit is ₹10."); return; }
        if (checkoutPaise > 5000000) { setDepositError("Maximum deposit is ₹50,000."); return; }
      }
    } else {
      setDepositError("Please select or enter an amount.");
      return;
    }

    setDepositError("");
    paymentResultDismissedRef.current = false;
    appliedPaymentResultRef.current = null;
    processingRef.current = true;
    setDepositStatus("creating");

    try {
      let checkoutUrl = "";
      let transactionId = "";

      if (depositProvider === "stripe") {
        if (__DEV__) console.log("[WalletDeposit] create payment started: stripe", checkoutCents, "cents");
        const res = await authFetch("/api/wallet/deposit/stripe/create-payment-intent", {
          method: "POST",
          body: JSON.stringify({ amountCents: checkoutCents }),
        });
        if (!res.ok) {
          throw new Error(await readPaymentApiError(res, "Failed to create Stripe payment."));
        }
        const data = (await res.json()) as { checkoutUrl: string; transactionId: string };
        checkoutUrl = data.checkoutUrl;
        transactionId = data.transactionId;
        if (__DEV__) console.log("[WalletDeposit] create payment success: stripe txId:", transactionId);
      } else {
        if (__DEV__) console.log("[WalletDeposit] create payment started: razorpay", checkoutPaise, "paise");
        const res = await authFetch("/api/wallet/deposit/razorpay/create-order", {
          method: "POST",
          body: JSON.stringify({ amountPaise: checkoutPaise }),
        });
        if (!res.ok) {
          throw new Error(await readPaymentApiError(res, "Failed to create Razorpay payment."));
        }
        const data = (await res.json()) as { checkoutUrl: string; transactionId: string };
        checkoutUrl = data.checkoutUrl;
        transactionId = data.transactionId;
        if (__DEV__) console.log("[WalletDeposit] create payment success: razorpay txId:", transactionId);
      }

      setDepositStatus("open");
      if (__DEV__) console.log("[WalletDeposit] provider checkout opened:", depositProvider);

      await savePendingDeposit({
        transactionId,
        provider: depositProvider,
        startedAt: new Date().toISOString(),
      });

      // ── Background poll ────────────────────────────────────────────────────
      // Poll while checkout is open. As soon as backend reports a terminal status,
      // show the wallet result immediately — do not wait for the browser session to end.
      let polledStatus: string | null = null;
      let pollStopped = false;
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let flowHandled = false;

      const completeDepositUi = async (source: string, fallbackUi?: PaymentResultStatus | null) => {
        if (flowHandled) return;

        const resolved = await resolveDepositUiFromTransaction(transactionId);
        const ui = resolved ?? fallbackUi ?? null;
        if (!ui) {
          if (__DEV__) console.log("[WalletDeposit] still settling:", source);
          return;
        }
        if (ui === "verification_failed" && !resolved) return;

        flowHandled = true;
        pollStopped = true;
        if (pollInterval) clearInterval(pollInterval);

        setShowDeposit(false);
        resetDeposit();
        void clearPendingDeposit();
        applyPaymentResult(ui, transactionId);
        void WebBrowser.dismissBrowser().catch(() => { /* already closed */ });
        if (__DEV__) console.log("[WalletDeposit] complete:", ui, `(${source})`);
      };

      const runPoll = async () => {
        if (pollStopped || polledStatus || flowHandled) return;
        try {
          const s = await fetchDepositStatus(transactionId);
          if (isPollCompleteDepositStatus(s)) {
            polledStatus = s;
            await completeDepositUi("poll", depositStatusToUiResult(s));
          }
        } catch {
          // ignore transient network errors, keep polling
        }
      };

      pollInterval = setInterval(() => void runPoll(), DEPOSIT_POLL_INTERVAL_MS);
      setTimeout(() => void runPoll(), DEPOSIT_POLL_FIRST_MS);
      void runPoll();

      // Android: openBrowserAsync + poll (avoids stuck "Return to WalkChamp" done page).
      // iOS: openAuthSessionAsync intercepts the custom-scheme redirect.
      const result =
        Platform.OS === "android"
          ? await WebBrowser.openBrowserAsync(checkoutUrl)
          : await WebBrowser.openAuthSessionAsync(checkoutUrl, PAYMENT_DEEP_LINK_SCHEME, {
              dismissButtonStyle: "close",
              presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
            });

      clearInterval(pollInterval!);
      pollStopped = true;

      if (flowHandled) {
        return;
      }

      // ── Final status check ─────────────────────────────────────────────────
      if (!polledStatus) {
        try {
          const s = await fetchDepositStatus(transactionId);
          if (isPollCompleteDepositStatus(s)) {
            polledStatus = s;
            if (__DEV__) console.log("[WalletDeposit] final status check:", s);
          }
        } catch {
          // fall through — will use result.type below
        }
      }

      // Always close the deposit input modal
      setShowDeposit(false);
      resetDeposit();

      // ── Resolve result ─────────────────────────────────────────────────────
      if (!flowHandled && polledStatus) {
        await completeDepositUi("post-browser", depositStatusToUiResult(polledStatus));
      } else if (!flowHandled && result.type === "success" && "url" in result && result.url) {
        if (__DEV__) console.log("[WalletDeposit] modal state: from deep link URL:", result.url);
        await completeDepositUi("deep-link");
      } else if (!flowHandled && (result.type === "cancel" || result.type === "dismiss")) {
        // Browser closed before payment completed (user manually dismissed)
        if (__DEV__) console.log("[WalletDeposit] modal state: cancelled (browser dismissed)");
        await completeDepositUi("browser-dismiss", "cancelled");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed. Please try again.";
      setDepositStatus("failed");
      setDepositError(msg);
      processingRef.current = false;
    }
  };

  const isDepositBusy =
    depositStatus === "creating" ||
    depositStatus === "open" ||
    depositStatus === "verifying" ||
    depositStatus === "success";

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: safeTop, paddingBottom: tabBarHeight },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: 16, paddingBottom: safeBottom + 40 },
        ]}
      >
        {/* Balance hero */}
        <LinearGradient
          colors={[colors.primary + "20", colors.accent + "10"]}
          style={[styles.balanceCard, { borderColor: colors.primary + "25" }]}
        >
          <Text style={[styles.balanceSectionLabel, { color: colors.mutedForeground }]}>
            Available Balance · {displayCurrency}
          </Text>
          <Text style={[styles.balanceBig, { color: colors.foreground }]}>
            {formatWalletAmount(availableBalance, displayCurrency)}
          </Text>

          {/* 3 balance columns */}
          <View style={[styles.balanceRowDivider, { backgroundColor: colors.border }]} />
          <View style={styles.balanceCols}>
            <View style={styles.balanceCol}>
              <Text style={[styles.balanceColLabel, { color: colors.mutedForeground }]}>
                Pending
              </Text>
              <Text style={[styles.balanceColValue, { color: colors.warning }]}>
                {formatWalletAmount(pendingBalance, displayCurrency)}
              </Text>
            </View>
            <View style={[styles.balanceColDivider, { backgroundColor: colors.border }]} />
            <View style={styles.balanceCol}>
              <Text style={[styles.balanceColLabel, { color: colors.mutedForeground }]}>
                Withdrawable
              </Text>
              <Text style={[styles.balanceColValue, { color: colors.primary }]}>
                {formatWalletAmount(withdrawableBalance, displayCurrency)}
              </Text>
            </View>
            <View style={[styles.balanceColDivider, { backgroundColor: colors.border }]} />
            <View style={styles.balanceCol}>
              <Text style={[styles.balanceColLabel, { color: colors.mutedForeground }]}>
                Total Earned
              </Text>
              <Text style={[styles.balanceColValue, { color: colors.gold }]}>
                {formatWalletAmount(totalEarned, displayCurrency)}
              </Text>
            </View>
          </View>

          {/* Action buttons row */}
          <View style={styles.actionRow}>
            {/* Deposit button */}
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.success + "18", borderColor: colors.success + "40", borderWidth: 1 }]}
              onPress={() => setShowDeposit(true)}
            >
              <Feather name="arrow-down-left" size={16} color={colors.success} />
              <Text style={[styles.actionBtnText, { color: colors.success }]}>Deposit</Text>
            </TouchableOpacity>

            {/* Withdraw button */}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: canWithdraw ? colors.primary : colors.border,
                  opacity: canWithdraw ? 1 : 0.6,
                },
              ]}
              onPress={() =>
                canWithdraw
                  ? setShowWithdraw(true)
                  : AppAlert.alert(
                      "Minimum $5 Required",
                      `Your withdrawable balance must be at least ${formatCurrency(MIN_WITHDRAWAL)}.`,
                    )
              }
            >
              <Feather
                name="arrow-up-right"
                size={16}
                color={canWithdraw ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.actionBtnText,
                  {
                    color: canWithdraw ? colors.primaryForeground : colors.mutedForeground,
                  },
                ]}
              >
                {canWithdraw ? "Withdraw" : `Need $${MIN_WITHDRAWAL} min`}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Pending note */}
          {pendingBalance > 0 && (
            <View
              style={[
                styles.pendingNote,
                { backgroundColor: colors.warning + "15" },
              ]}
            >
              <Feather name="clock" size={13} color={colors.warning} />
              <Text
                style={[styles.pendingNoteText, { color: colors.warning }]}
              >
                {formatCurrency(pendingBalance)} pending verification — typically 24–48 hours
              </Text>
            </View>
          )}
        </LinearGradient>

        {/* How to Earn */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          How to Earn Cash
        </Text>
        <View style={styles.earnGrid}>
          {EARN_CARDS.map((card) => {
            const glowColors =
              card.glow === "bottomLeft"
                ? [card.color + "00", card.color + "00", card.color + "55"]
                : card.glow === "bottomRight"
                  ? [card.color + "00", card.color + "00", card.color + "55"]
                  : [card.color + "00", card.color + "28", card.color + "00"];
            const glowStart =
              card.glow === "bottomLeft"
                ? { x: 0, y: 1 }
                : card.glow === "bottomRight"
                  ? { x: 1, y: 1 }
                  : { x: 0.5, y: 0.5 };
            const glowEnd =
              card.glow === "bottomLeft"
                ? { x: 0.85, y: 0.15 }
                : card.glow === "bottomRight"
                  ? { x: 0.15, y: 0.15 }
                  : { x: 0.5, y: 0 };

            return (
              <View
                key={card.title}
                style={[
                  styles.earnCard,
                  card.fullWidth && styles.earnCardFull,
                  card.fullWidth && !card.showArt && styles.earnCardRow,
                  card.showArt && styles.earnCardReferral,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <LinearGradient
                  colors={glowColors as [string, string, ...string[]]}
                  start={glowStart}
                  end={glowEnd}
                  style={StyleSheet.absoluteFillObject}
                  pointerEvents="none"
                />
                {card.showArt ? (
                  <>
                    <View style={styles.earnReferralLeft}>
                      <View
                        style={[
                          styles.earnIconBox,
                          styles.earnIconBoxRow,
                          { backgroundColor: card.color + "18" },
                        ]}
                      >
                        <Feather name={card.icon} size={20} color={card.color} />
                      </View>
                      <View style={styles.earnCardTextCol}>
                        <Text style={[styles.earnCardTitleRow, { color: colors.foreground }]}>
                          {card.title}
                        </Text>
                        <Text style={[styles.earnCardRewardRow, { color: card.color }]}>
                          {card.reward}
                        </Text>
                        <Text style={[styles.earnCardSubRow, { color: colors.mutedForeground }]}>
                          {card.sub}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.earnReferralArtWrap}>
                      <Image
                        source={REFERRAL_ART}
                        style={styles.earnReferralArt}
                        resizeMode="contain"
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <View
                      style={[
                        styles.earnIconBox,
                        { backgroundColor: card.color + "18" },
                      ]}
                    >
                      <Feather name={card.icon} size={18} color={card.color} />
                    </View>
                    <Text style={[styles.earnCardTitle, { color: colors.foreground }]}>
                      {card.title}
                    </Text>
                    <Text style={[styles.earnCardReward, { color: card.color }]}>
                      {card.reward}
                    </Text>
                    <Text style={[styles.earnCardSub, { color: colors.mutedForeground }]}>
                      {card.sub}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
        </View>

        {/* Withdrawal info */}
        <View
          style={[
            styles.withdrawInfoCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.withdrawInfoTitle, { color: colors.foreground }]}>
            Withdrawal Info
          </Text>
          {[
            { icon: "dollar-sign" as const, text: "Minimum withdrawal: $5.00" },
            { icon: "clock" as const, text: "Processing time: 1–3 business days" },
            { icon: "shield" as const, text: "Manual admin review required — must be 18+" },
            {
              icon: "activity" as const,
              text: "Withdrawable balance comes from verified challenge rewards only",
            },
            {
              icon: "alert-triangle" as const,
              text: "Suspicious activity flags will block withdrawals pending review",
            },
          ].map((item) => (
            <View key={item.icon} style={styles.withdrawInfoRow}>
              <Feather name={item.icon} size={14} color={colors.mutedForeground} />
              <Text
                style={[styles.withdrawInfoText, { color: colors.mutedForeground }]}
              >
                {item.text}
              </Text>
            </View>
          ))}
        </View>

        {/* Disclaimer */}
        <View
          style={[
            styles.disclaimer,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="info" size={14} color={colors.mutedForeground} />
          <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
            All rewards are subject to verification of genuine walking activity. Suspicious or
            fraudulent activity may result in reward cancellation, account suspension, or withdrawal
            rejection. Walk Champ is a skill-based activity platform — results depend on your actual
            step performance. Submission of a withdrawal request does not guarantee payout.
          </Text>
        </View>

        {/* Transactions */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Transaction History
        </Text>
        <ScrollView
          style={[
            styles.txList,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {transactions.length === 0 ? (
            <View style={styles.emptyTx}>
              <Feather name="inbox" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No transactions yet
              </Text>
            </View>
          ) : (
            transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} colors={colors} />
            ))
          )}
        </ScrollView>
      </ScrollView>

      {/* ── Deposit Modal ──────────────────────────────────────────────────── */}
      <Modal visible={showDeposit} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Money</Text>
            <TouchableOpacity onPress={closeDeposit} disabled={isDepositBusy}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">

            {/* ── Country-based payment provider display ────────────────────── */}
            {!hasCountry ? (
              <View style={[styles.noCountryCard, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "40" }]}>
                <Feather name="map-pin" size={20} color={colors.warning} />
                <View style={styles.noCountryText}>
                  <Text style={[styles.noCountryTitle, { color: colors.foreground }]}>Country not set</Text>
                  <Text style={[styles.noCountryMsg, { color: colors.mutedForeground }]}>
                    Please update your country in Profile settings to enable deposits.
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <Text style={[styles.depositSectionLabel, { color: colors.mutedForeground }]}>Payment method</Text>
                <View style={[
                  styles.providerInfoCard,
                  {
                    backgroundColor: (depositProvider === "stripe" ? "#635BFF" : "#0052CC") + "15",
                    borderColor: depositProvider === "stripe" ? "#635BFF" : "#0052CC",
                  },
                ]}>
                  <Text style={styles.providerCardEmoji}>{depositProvider === "stripe" ? "💳" : "₹"}</Text>
                  <View style={styles.providerInfoText}>
                    <Text style={[styles.providerCardName, { color: depositProvider === "stripe" ? "#635BFF" : "#0052CC" }]}>
                      {depositProvider === "stripe" ? "Stripe" : "Razorpay"}
                    </Text>
                    <Text style={[styles.providerCardSub, { color: colors.mutedForeground }]}>
                      {depositProvider === "stripe" ? "USD · International Cards" : "INR · UPI / Cards (India)"}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* ── Amount, pay button — only shown when country is known ────── */}
            {hasCountry && (
              <>
                <Text style={[styles.depositSectionLabel, { color: colors.mutedForeground }]}>Select amount</Text>
                <View style={styles.presetGrid}>
                  {(depositProvider === "stripe" ? STRIPE_PRESETS : RAZORPAY_PRESETS).map((preset) => {
                    const accentColor = depositProvider === "stripe" ? "#635BFF" : "#0052CC";
                    const isSelected = selectedPreset?.label === preset.label;
                    return (
                      <TouchableOpacity
                        key={preset.label}
                        style={[
                          styles.presetChip,
                          {
                            backgroundColor: isSelected ? accentColor : colors.card,
                            borderColor: isSelected ? accentColor : colors.border,
                          },
                        ]}
                        onPress={() => {
                          setSelectedPreset(depositProvider === "stripe"
                            ? { label: preset.label, cents: (preset as typeof STRIPE_PRESETS[0]).cents }
                            : { label: preset.label, paise: (preset as typeof RAZORPAY_PRESETS[0]).paise });
                          setCustomMode(false);
                          setDepositAmountStr("");
                          setDepositError("");
                        }}
                        disabled={isDepositBusy}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.presetChipText, { color: isSelected ? "#fff" : colors.foreground }]}>
                          {preset.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* Custom chip */}
                  <TouchableOpacity
                    style={[
                      styles.presetChip,
                      styles.presetChipCustom,
                      {
                        backgroundColor: customMode ? colors.primary + "18" : colors.card,
                        borderColor: customMode ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => { setCustomMode(true); setSelectedPreset(null); setDepositError(""); }}
                    disabled={isDepositBusy}
                  >
                    <Feather name="edit-2" size={13} color={customMode ? colors.primary : colors.mutedForeground} />
                    <Text style={[styles.presetChipText, { color: customMode ? colors.primary : colors.mutedForeground }]}>
                      Custom
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* ── Custom input ──────────────────────────────────────────── */}
                {customMode && (
                  <View style={[styles.amountInput, { backgroundColor: colors.card, borderColor: depositError ? colors.destructive : colors.border }]}>
                    <Text style={[styles.currencySign, { color: colors.foreground }]}>
                      {depositProvider === "stripe" ? "$" : "₹"}
                    </Text>
                    <TextInput
                      style={[styles.amountField, { color: colors.foreground }]}
                      placeholder={depositProvider === "stripe" ? "0.00" : "0"}
                      placeholderTextColor={colors.mutedForeground}
                      value={depositAmountStr}
                      onChangeText={(v) => { setDepositAmountStr(v.replace(/[^0-9.]/g, "")); setDepositError(""); }}
                      keyboardType="decimal-pad"
                      autoFocus
                      editable={!isDepositBusy}
                    />
                  </View>
                )}

                {/* ── Error ─────────────────────────────────────────────────── */}
                {!!depositError && (
                  <View style={[styles.depositError, { backgroundColor: colors.destructive + "12" }]}>
                    <Feather name="alert-circle" size={14} color={colors.destructive} />
                    <Text style={[styles.depositErrorText, { color: colors.destructive }]}>{depositError}</Text>
                  </View>
                )}

                {/* ── Pay button ────────────────────────────────────────────── */}
                <TouchableOpacity
                  style={[
                    styles.payBtn,
                    {
                      backgroundColor: depositProvider === "stripe" ? "#635BFF" : "#0052CC",
                      opacity: isDepositBusy ? 0.55 : 1,
                    },
                  ]}
                  onPress={() => void handleDeposit()}
                  disabled={isDepositBusy}
                >
                  {isDepositBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name={depositProvider === "stripe" ? "credit-card" : "smartphone"} size={18} color="#fff" />
                      <Text style={styles.payBtnText}>
                        {selectedPreset
                          ? `Pay ${selectedPreset.label} with ${depositProvider === "stripe" ? "Stripe" : "Razorpay"}`
                          : `Pay with ${depositProvider === "stripe" ? "Stripe" : "Razorpay"}`}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Secure badge */}
                <View style={styles.secureBadge}>
                  <Feather name="lock" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.secureBadgeText, { color: colors.mutedForeground }]}>
                    Secure &amp; encrypted. Wallet updates only after verified payment.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Payment Result Modal ───────────────────────────────────────────── */}
      <Modal
        visible={paymentResult !== "hidden"}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={closePaymentResult}
      >
        <View style={styles.resultOverlay}>
          <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {paymentResult === "verifying" && (
              <>
                <ActivityIndicator size="large" color={colors.primary} style={styles.resultSpinner} />
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Verifying Payment</Text>
                <Text style={[styles.resultMsg, { color: colors.mutedForeground }]}>
                  Payment recorded. Your wallet will update after backend verification — usually within a few minutes.
                </Text>
              </>
            )}

            {paymentResult === "success" && (
              <>
                <View style={[styles.resultIconWrap, { backgroundColor: colors.success + "18" }]}>
                  <Feather name="check-circle" size={44} color={colors.success} />
                </View>
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Deposit Successful</Text>
                <Text style={[styles.resultMsg, { color: colors.mutedForeground }]}>
                  Payment verified. Your wallet balance has been updated.
                </Text>
                <TouchableOpacity
                  style={[styles.resultBtn, { backgroundColor: colors.success }]}
                  onPress={closePaymentResult}
                >
                  <Text style={styles.resultBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            )}

            {paymentResult === "cancelled" && (
              <>
                <View style={[styles.resultIconWrap, { backgroundColor: colors.warning + "18" }]}>
                  <Feather name="x-circle" size={44} color={colors.warning} />
                </View>
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Payment Cancelled</Text>
                <Text style={[styles.resultMsg, { color: colors.mutedForeground }]}>
                  You cancelled the payment. No amount was added to your wallet.
                </Text>
                <TouchableOpacity
                  style={[styles.resultBtn, { backgroundColor: colors.warning }]}
                  onPress={closePaymentResult}
                >
                  <Text style={styles.resultBtnText}>OK</Text>
                </TouchableOpacity>
              </>
            )}

            {(paymentResult === "failed" || paymentResult === "verification_failed") && (
              <>
                <View style={[styles.resultIconWrap, { backgroundColor: colors.destructive + "18" }]}>
                  <Feather name="alert-circle" size={44} color={colors.destructive} />
                </View>
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                  {paymentResult === "verification_failed" ? "Verification Pending" : "Payment Failed"}
                </Text>
                <Text style={[styles.resultMsg, { color: colors.mutedForeground }]}>
                  {paymentResult === "verification_failed"
                    ? "Payment recorded. Wallet credit is still being verified. If money was deducted, it will be credited shortly or refunded. Contact support with your transaction ID if it does not resolve."
                    : "Your payment could not be completed. No amount was deducted. Please try again."}
                </Text>
                <TouchableOpacity
                  style={[styles.resultBtn, { backgroundColor: colors.destructive }]}
                  onPress={closePaymentResult}
                >
                  <Text style={styles.resultBtnText}>OK</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Withdraw Modal ─────────────────────────────────────────────────── */}
      <Modal visible={showWithdraw} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Request Withdrawal
            </Text>
            <TouchableOpacity onPress={() => setShowWithdraw(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <View
              style={[
                styles.modalBalance,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.modalBalanceLabel, { color: colors.mutedForeground }]}>
                Withdrawable
              </Text>
              <Text style={[styles.modalBalanceValue, { color: colors.primary }]}>
                {formatCurrency(withdrawableBalance)}
              </Text>
            </View>

            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>
              Amount (min. $5.00)
            </Text>
            <View
              style={[
                styles.amountInput,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.currencySign, { color: colors.foreground }]}>$</Text>
              <TextInput
                style={[styles.amountField, { color: colors.foreground }]}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
              />
            </View>

            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>
              Payout Method
            </Text>
            {PAYOUT_METHODS.map((method) => (
              <TouchableOpacity
                key={method}
                style={[
                  styles.methodRow,
                  {
                    backgroundColor:
                      selectedMethod === method
                        ? colors.primary + "12"
                        : colors.card,
                    borderColor:
                      selectedMethod === method ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedMethod(method)}
              >
                <Text
                  style={[
                    styles.methodText,
                    {
                      color:
                        selectedMethod === method
                          ? colors.primary
                          : colors.foreground,
                    },
                  ]}
                >
                  {method}
                </Text>
                {selectedMethod === method && (
                  <Feather name="check-circle" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}

            <View
              style={[
                styles.withdrawNote,
                {
                  backgroundColor: colors.warning + "12",
                  borderColor: colors.warning + "25",
                },
              ]}
            >
              <Feather name="alert-circle" size={14} color={colors.warning} />
              <Text
                style={[styles.withdrawNoteText, { color: colors.warning }]}
              >
                Status flow:{" "}
                <Text style={{ fontWeight: "700" }}>
                  Pending → Approved → Paid
                </Text>
                . Manual admin review is required. Submission does not guarantee
                payout. Fraudulent or ineligible accounts will be rejected. You
                must be 18+ to withdraw.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.confirmBtn, { borderRadius: 14, overflow: "hidden" }]}
              onPress={handleWithdraw}
            >
              <LinearGradient
                colors={[colors.primary, colors.accent]}
                style={styles.confirmGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={[styles.confirmText, { color: colors.primaryForeground }]}>
                  Submit Withdrawal Request
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: rs(20) },
  balanceCard: { borderRadius: 20, borderWidth: 1, padding: rs(20), marginBottom: rs(24), gap: 10 },
  balanceSectionLabel: { fontSize: rf(13) },
  balanceBig: { fontSize: rf(46), fontWeight: "800", letterSpacing: -1 },
  balanceRowDivider: { height: StyleSheet.hairlineWidth },
  balanceCols: { flexDirection: "row", alignItems: "center", paddingTop: 4 },
  balanceCol: { flex: 1, alignItems: "center", gap: 3 },
  balanceColDivider: { width: 1, height: 32 },
  balanceColLabel: { fontSize: rf(11) },
  balanceColValue: { fontSize: rf(16), fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 14,
    paddingVertical: rs(14),
  },
  actionBtnText: { fontSize: rf(14), fontWeight: "700" },
  pendingNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    padding: rs(10),
  },
  pendingNoteText: { flex: 1, fontSize: rf(12) },
  sectionTitle: { fontSize: rf(18), fontWeight: "700", marginBottom: 14 },
  earnGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  earnCard: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1,
    padding: rs(14),
    gap: 4,
    overflow: "hidden",
    position: "relative",
  },
  earnCardFull: { width: "100%" },
  earnCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: rs(14),
    paddingHorizontal: rs(14),
  },
  earnCardReferral: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: rs(12),
    paddingLeft: rs(12),
    paddingRight: rs(10),
    gap: 8,
    overflow: "hidden",
  },
  earnReferralLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    zIndex: 1,
    paddingRight: rs(4),
  },
  earnIconBox: {
    width: rs(40),
    height: rs(40),
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    zIndex: 1,
  },
  earnIconBoxRow: {
    marginBottom: 0,
    flexShrink: 0,
  },
  earnCardTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    justifyContent: "center",
    zIndex: 1,
  },
  earnCardTitle: { fontSize: rf(13), fontWeight: "700" },
  earnCardTitleRow: { fontSize: rf(14), fontWeight: "700" },
  earnCardReward: { fontSize: rf(15), fontWeight: "800" },
  earnCardRewardRow: { fontSize: rf(17), fontWeight: "800", marginTop: 1 },
  earnCardSub: { fontSize: rf(11), lineHeight: 15 },
  earnCardSubRow: { fontSize: rf(12), lineHeight: 16, marginTop: 2 },
  earnReferralArtWrap: {
    width: rs(72),
    height: rs(72),
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: 8,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  earnReferralArt: {
    width: rs(72),
    height: rs(72),
  },
  withdrawInfoCard: { borderRadius: 14, borderWidth: 1, padding: rs(14), gap: 10, marginBottom: 14 },
  withdrawInfoTitle: { fontSize: rf(15), fontWeight: "700" },
  withdrawInfoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  withdrawInfoText: { flex: 1, fontSize: rf(13), lineHeight: 18 },
  disclaimer: {
    borderRadius: 12,
    borderWidth: 1,
    padding: rs(14),
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 20,
  },
  disclaimerText: { flex: 1, fontSize: rf(12), lineHeight: 18 },
  // Same constrained box as before (~5 rows at 320); ~10 rows at 640, then scroll inside.
  txList: { borderRadius: 16, borderWidth: 1, overflow: "hidden", maxHeight: rs(640) },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: rs(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  txIcon: {
    width: rs(38),
    height: rs(38),
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: { flex: 1, gap: 4 },
  txDesc: { fontSize: rf(14), fontWeight: "600" },
  txLedgerBadge: { fontSize: rf(11), marginTop: 2 },
  txMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  txDate: { fontSize: rf(12) },
  txStatusChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  txStatusText: { fontSize: rf(11), fontWeight: "600" },
  txAmount: { fontSize: rf(15), fontWeight: "700" },
  emptyTx: { padding: rs(32), alignItems: "center", gap: 8 },
  emptyText: { fontSize: rf(15) },
  // Modal shared
  modal: { flex: 1, paddingTop: 20 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: rs(24),
    paddingBottom: rs(16),
  },
  modalTitle: { fontSize: rf(20), fontWeight: "700" },
  modalContent: { paddingHorizontal: rs(24), gap: 12, paddingBottom: 40 },
  modalBalance: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
  },
  modalBalanceLabel: { fontSize: rf(14) },
  modalBalanceValue: { fontSize: rf(22), fontWeight: "800" },
  modalLabel: { fontSize: rf(13), fontWeight: "600" },
  amountInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
  },
  currencySign: { fontSize: rf(22), fontWeight: "700" },
  amountField: { flex: 1, fontSize: rf(26), fontWeight: "700" },
  methodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
  },
  methodText: { fontSize: rf(16), fontWeight: "500" },
  withdrawNote: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    padding: rs(12),
  },
  withdrawNoteText: { flex: 1, fontSize: rf(13), lineHeight: 18 },
  confirmBtn: {},
  confirmGradient: { paddingVertical: rs(16), alignItems: "center" },
  confirmText: { fontSize: rf(17), fontWeight: "700" },
  // Deposit-specific
  depositSectionLabel: { fontSize: rf(12), fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  providerCards: { flexDirection: "row", gap: 10 },
  providerCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: rs(14),
    alignItems: "center",
    gap: 4,
    position: "relative",
  },
  providerInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: rs(16),
  },
  providerInfoText: { flex: 1, gap: 2 },
  providerCardEmoji: { fontSize: rf(24) },
  providerCardName: { fontSize: rf(15), fontWeight: "700" },
  providerCardSub: { fontSize: rf(11) },
  providerCardDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  noCountryCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: rs(16),
  },
  noCountryText: { flex: 1, gap: 4 },
  noCountryTitle: { fontSize: rf(15), fontWeight: "700" },
  noCountryMsg: { fontSize: rf(13), lineHeight: 18 },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  presetChip: {
    minWidth: 72,
    paddingHorizontal: rs(20),
    paddingVertical: rs(14),
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  presetChipCustom: {
    flexDirection: "row",
    gap: 5,
  },
  presetChipText: { fontSize: rf(15), fontWeight: "700" },
  customBlock: { gap: 10 },
  depositError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    padding: rs(12),
  },
  depositErrorText: { flex: 1, fontSize: rf(13) },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    padding: rs(14),
  },
  statusText: { fontSize: rf(14), fontWeight: "600" },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: rs(16),
  },
  payBtnText: { fontSize: rf(17), fontWeight: "700", color: "#fff" },
  secureBadge: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 4,
  },
  secureBadgeText: { flex: 1, fontSize: rf(12), lineHeight: 17 },
  // Payment result overlay
  resultOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(24),
  },
  resultCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 22,
    borderWidth: 1,
    padding: rs(28),
    alignItems: "center",
    gap: 14,
  },
  resultSpinner: { marginBottom: 4 },
  resultIconWrap: {
    width: rs(80),
    height: rs(80),
    borderRadius: rs(40),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  resultTitle: { fontSize: rf(20), fontWeight: "700", textAlign: "center" },
  resultMsg: { fontSize: rf(14), lineHeight: 20, textAlign: "center" },
  resultBtn: {
    width: "100%",
    borderRadius: 14,
    paddingVertical: rs(15),
    alignItems: "center",
    marginTop: 4,
  },
  resultBtnText: { fontSize: rf(16), fontWeight: "700", color: "#fff" },
});
