import { LinearGradient } from "expo-linear-gradient";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ImageSourcePropType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/utils/haptics";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import { getLocalDateStr } from "@/utils/timezone";
import { AppAlert } from "@/components/AppAlert";
import CoinIcon from "@/components/CoinIcon";
import { Image } from "react-native";
import { ENABLE_MIC_PASS } from "@/config/featureFlags";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchTrackThemes,
  purchaseTrackTheme,
  equipTrackTheme,
  clearPurchaseError,
  type TrackTheme,
} from "@/store/slices/trackThemesSlice";
import {
  fetchCoinBalance,
  fetchPurchaseSummary,
  type PurchaseHistoryItem,
} from "@/store/slices/coinsSlice";
import {
  initializeIAP,
  cleanupIAP,
  loadIAPProducts,
  purchaseProduct,
  setupPurchaseListeners,
  restoreMicPass,
  retryPendingPurchases,
  COIN_IAP_PRODUCTS,
  MIC_PASS_PRODUCT_ID,
  type CoinProduct,
} from "@/services/iapService";
import type { Product } from "react-native-iap";
import { authFetch } from "@/utils/authFetch";
import BannerAdView from "@/components/BannerAdView";
import {
  preloadRewardedAd,
  showRewardedAdForCoins,
  isRewardedAdReady,
  isNativeAdsAvailable,
} from "@/services/ads/adMobService";
import { useColors } from "@/hooks/useColors";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";

const shopImage = require("@/assets/images/shop-icon.png");

// ── Local asset map — same keys as live-detail.tsx ──────────────────────────
const TRACK_ASSETS: Record<string, ImageSourcePropType> = {
  bg:              require("@/assets/images/bg.png"),
  bg1:             require("@/assets/images/bg1.png"),
  galaxy:          require("@/assets/images/galaxy.jpeg"),
  daylightStadium: require("@/assets/images/daylightStadium.jpeg"),
  forest:          require("@/assets/images/forest.jpeg"),
  city:            require("@/assets/images/city.jpeg"),
  lava:            require("@/assets/images/lava.jpeg"),
  ice:             require("@/assets/images/ice.jpeg"),
  candy:           require("@/assets/images/candy.jpeg"),
  farm:            require("@/assets/images/farm.jpeg"),
  underwater:      require("@/assets/images/underwater.jpeg"),
  musicfest:       require("@/assets/images/musicfest.jpeg"),
  barbie:          require("@/assets/images/track_barbie.png"),
  desert:          require("@/assets/images/track_desert.png"),
  gold:            require("@/assets/images/track_gold.png"),
  nightforest:     require("@/assets/images/track_nightforest.png"),
  skykingdom:      require("@/assets/images/track_skykingdom.png"),
  rain:            require("@/assets/images/track_rain.png"),
  storm:           require("@/assets/images/track_storm.png"),
  mountain:        require("@/assets/images/track_mountain.png"),
  waterfall:       require("@/assets/images/track_waterfall.png"),
  webcity:         require("@/assets/images/track_webcity.png"),
  bridge:          require("@/assets/images/track_bridge.png"),
  newyork:         require("@/assets/images/track_newyork.png"),
  pirateisland:    require("@/assets/images/track_pirateisland.png"),
  paradise:        require("@/assets/images/track_paradise.png"),
  musicfest2:      require("@/assets/images/track_musicfest2.png"),
  // ── Premium race-track skins ──────────────────────────────────────────────
  chocolate:       require("@/assets/images/track_chocolate.png"),
  fireworks:       require("@/assets/images/track_fireworks.png"),
  moon:            require("@/assets/images/track_moon.png"),
  rainbow_road:    require("@/assets/images/track_rainbow_road.png"),
  runway:          require("@/assets/images/track_runway.png"),
  toy_race:        require("@/assets/images/track_toy_race.png"),
  water_park:      require("@/assets/images/track_water_park.png"),
};

function getAsset(key: string | null | undefined): ImageSourcePropType | null {
  if (!key) return null;
  return TRACK_ASSETS[key] ?? null;
}

// Fallback coin pack labels used only when store products haven't loaded yet
const COIN_PACK_FALLBACKS = COIN_IAP_PRODUCTS.map((p) => ({
  productId: p.productId,
  coins: p.coins,
  name: p.name,
}));

type ShopTab = "coins" | "themes" | "premium";

interface Props {
  visible: boolean;
  onClose: () => void;
  onCoinsAdded?: () => void;
  onMicPassGranted?: () => void;
  /** When true, renders as a full-screen tab (no Modal wrapper, no close button). */
  standalone?: boolean;
}

async function safeJson(res: Response): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return { ok: false, error: "Could not connect to service. Please try again." };
  return { ok: true, data: await res.json() as Record<string, unknown> };
}

// ── Mic Pass state (non-Redux) ───────────────────────────────────────────────
function useMicPassEntitlement(visible: boolean) {
  const [hasMicPass, setHasMicPass] = useState(false);
  const [loadingMic, setLoadingMic] = useState(false);

  const fetchMicEntitlement = useCallback(async () => {
    if (!ENABLE_MIC_PASS) return;
    setLoadingMic(true);
    try {
      const session = await getValidSession();
      if (!session) return;
      const res = await fetch(`${getApiBase()}/api/users/me/entitlements`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (res.ok) {
        const data = await res.json() as { entitlements?: { mic_pass?: boolean } };
        setHasMicPass(data?.entitlements?.mic_pass === true);
      }
    } catch { } finally { setLoadingMic(false); }
  }, []);

  useEffect(() => { if (visible) void fetchMicEntitlement(); }, [visible, fetchMicEntitlement]);

  return { hasMicPass, setHasMicPass, loadingMic, fetchMicEntitlement };
}

// ── Theme card ───────────────────────────────────────────────────────────────
function ThemeCard({ theme, onUnlock, onEquip }: {
  theme: TrackTheme;
  onUnlock: (code: string) => void;
  onEquip: (code: string) => void;
}) {
  const c = useColors();
  const purchaseLoading = useAppSelector((s) => s.trackThemes.purchaseLoading);
  const asset = getAsset(theme.assetKey ?? theme.code);
  const isLoading = purchaseLoading === theme.code;

  const tc = {
    card:           { width: "47.8%" as const, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: "hidden" as const },
    imgWrap:        {} as object,
    img:            { width: "100%" as const, height: 88, justifyContent: "flex-end" as const, padding: 5 },
    imgFallback:    { backgroundColor: c.muted, alignItems: "center" as const, justifyContent: "center" as const },
    lockOverlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)", alignItems: "flex-end" as const, justifyContent: "flex-start" as const, padding: 5, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
    lockBox:        { backgroundColor: c.muted, borderRadius: 6, width: 22, height: 22, alignItems: "center" as const, justifyContent: "center" as const },
    equippedBadge:  { flexDirection: "row" as const, alignItems: "center" as const, gap: 3, backgroundColor: "#7C3AED", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-end" as const },
    equippedTxt:    { fontSize: 9, fontWeight: "800" as const, color: "#fff" },
    ownedBadge:     { backgroundColor: "#14532D", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-end" as const },
    ownedTxt:       { fontSize: 9, fontWeight: "800" as const, color: "#4ADE80" },
    body:           { padding: 8 },
    name:           { fontSize: 12, fontWeight: "700" as const, color: c.foreground, marginBottom: 6 },
    footer:         { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 4 },
    pricePill:      { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
    priceNum:       { fontSize: 11, fontWeight: "700" as const, color: "#FFD700" },
    actionBtn:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, minWidth: 48, alignItems: "center" as const, justifyContent: "center" as const },
    actionBtnDisabled: { backgroundColor: c.muted },
    unlockBtn:      { backgroundColor: "#7C3AED" },
    useBtn:         { backgroundColor: "#22C55E" },
    actionTxt:      { fontSize: 10, fontWeight: "800" as const, color: "#fff" },
    actionTxtDim:   { color: c.mutedForeground },
    useTxt:         { fontSize: 10, fontWeight: "800" as const, color: "#000" },
    selectedPill:   { flexDirection: "row" as const, alignItems: "center" as const, gap: 3, backgroundColor: "#2D1064", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, width: "100%" as const, justifyContent: "center" as const },
    selectedTxt:    { fontSize: 10, fontWeight: "700" as const, color: "#A855F7" },
  };

  const inner = (
    <View style={tc.card}>
      {/* Image */}
      <View style={tc.imgWrap}>
        {asset ? (
          <ImageBackground source={asset} style={tc.img} imageStyle={{ borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>
            {theme.isEquipped && (
              <View style={tc.equippedBadge}>
                <Feather name="check" size={10} color="#fff" />
                <Text style={tc.equippedTxt}>Equipped</Text>
              </View>
            )}
            {theme.locked && (
              <View style={tc.lockOverlay}>
                <View style={tc.lockBox}><Feather name="lock" size={13} color="#fff" /></View>
              </View>
            )}
            {!theme.locked && !theme.isEquipped && theme.owned && (
              <View style={tc.ownedBadge}><Text style={tc.ownedTxt}>Owned</Text></View>
            )}
          </ImageBackground>
        ) : (
          <View style={[tc.img, tc.imgFallback]}>
            <Feather name="image" size={22} color="#3A3A5A" />
            {theme.locked && <View style={[tc.lockBox, { marginTop: 6 }]}><Feather name="lock" size={13} color="#fff" /></View>}
          </View>
        )}
      </View>

      {/* Info + action */}
      <View style={tc.body}>
        <Text style={tc.name} numberOfLines={1}>{theme.name}</Text>
        <View style={tc.footer}>
          {theme.isEquipped ? (
            <View style={tc.selectedPill}>
              <Feather name="check-circle" size={11} color="#A855F7" />
              <Text style={tc.selectedTxt}>Selected</Text>
            </View>
          ) : theme.locked ? (
            <>
              <View style={tc.pricePill}>
                <CoinIcon size="small" />
                <Text style={tc.priceNum}>{theme.priceCoins.toLocaleString()}</Text>
              </View>
              <TouchableOpacity
                style={[tc.actionBtn, tc.unlockBtn, !theme.canPurchase && tc.actionBtnDisabled]}
                onPress={() => onUnlock(theme.code)}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={[tc.actionTxt, !theme.canPurchase && tc.actionTxtDim]}>
                      {theme.canPurchase ? "Unlock" : `Need ${theme.coinsNeeded.toLocaleString()}`}
                    </Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[tc.actionBtn, tc.useBtn]} onPress={() => onEquip(theme.code)} activeOpacity={0.8}>
              <Text style={tc.useTxt}>Use</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  return inner;
}


// ── Main modal ────────────────────────────────────────────────────────────────
export default function CoinsStoreModal({ visible, onClose, onCoinsAdded, onMicPassGranted, standalone = false }: Props) {
  const dispatch = useAppDispatch();
  const colors = useColors();
  const tabBarHeight = useTabBarHeight();
  const s = makeStoreStyles(colors);
  const scrollBottomPad = 24;
  const { themes, coinBalance, loading: themesLoading, error: themesError, purchaseError } = useAppSelector((st) => st.trackThemes);
  const { purchaseSummary, summaryLoading } = useAppSelector((st) => st.coins);

  const [activeTab, setActiveTab] = useState<ShopTab>("coins");
  const [balance, setBalance]               = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [refreshingCoins, setRefreshingCoins] = useState(false);
  const [watchingAd, setWatchingAd] = useState(false);
  const [adsToday, setAdsToday] = useState(0);

  // ── IAP state ──────────────────────────────────────────────────────────────
  const [coinProducts, setCoinProducts]       = useState<CoinProduct[]>([]);
  const [premiumProduct, setPremiumProduct]   = useState<Product | null>(null);
  const [iapLoading, setIapLoading]           = useState(false);
  const [iapError, setIapError]               = useState<string | null>(null);
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);
  const [restoringMic, setRestoringMic]       = useState(false);
  const cleanupListenersRef                   = useRef<(() => void) | null>(null);

  const { hasMicPass, setHasMicPass, loadingMic, fetchMicEntitlement } = useMicPassEntitlement(visible);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true);
    try {
      const session = await getValidSession();
      if (!session) return;
      const res = await fetch(`${getApiBase()}/api/coins/balance?localDate=${getLocalDateStr()}`, { headers: { Authorization: `Bearer ${session}` } });
      if (res.ok) {
        const data = await res.json() as { currentBalance?: number };
        setBalance(data.currentBalance ?? 0);
      }
    } catch { } finally { setLoadingBalance(false); }
  }, []);

  // Build purchase listeners callback object (stable ref — does not itself trigger useEffect)
  const listenersCallbacks = useCallback(() => ({
    onCoinPurchase: (productId: string, coins: number, newBalance: number) => {
      setBuyingProductId(null);
      setBalance(newBalance);
      onCoinsAdded?.();
      AppAlert.alert(
        "Purchase Successful 🎉",
        `${coins.toLocaleString()} coins added to your balance.`,
      );
    },
    onMicPassGrant: () => {
      setBuyingProductId(null);
      setHasMicPass(true);
      onMicPassGranted?.();
      void fetchMicEntitlement();
      AppAlert.alert(
        "Mic Pass Activated 🎤",
        "Voice chat is now enabled in all eligible races.",
      );
    },
    onPending: (msg: string) => {
      setBuyingProductId(null);
      AppAlert.alert("Purchase Received", msg);
    },
    onError: (msg: string) => {
      setBuyingProductId(null);
      AppAlert.alert("Purchase Failed", msg);
    },
  }), [onCoinsAdded, onMicPassGranted, setHasMicPass, fetchMicEntitlement]);

  // Load IAP products from App Store / Google Play.
  // Listeners are attached here — AFTER initConnection() completes — to avoid
  // the E_IAP_NOT_AVAILABLE race that occurs when purchaseUpdatedListener is
  // called before the connection is initialized.
  const loadProducts = useCallback(async () => {
    setIapLoading(true);
    setIapError(null);
    try {
      await initializeIAP();

      // Attach listeners immediately after connection is established
      cleanupListenersRef.current?.();
      cleanupListenersRef.current = setupPurchaseListeners(listenersCallbacks());

      const { coinProducts: cp, premiumProduct: pp } = await loadIAPProducts();
      setCoinProducts(cp);
      setPremiumProduct(pp);

      // Retry any pending verifications from previous sessions
      await retryPendingPurchases({
        onCoinPurchase: (_productId, _coins, newBalance) => {
          setBalance(newBalance);
          onCoinsAdded?.();
        },
        onMicPassGrant: () => {
          setHasMicPass(true);
          onMicPassGranted?.();
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "E_IAP_NOT_AVAILABLE") {
        // Expo Go or simulator — not an error, just not supported
        setIapError("In-app purchases require the installed app.\nCoin prices will show once you install the build.");
      } else {
        setIapError("Unable to load products. Please try again.");
      }
    } finally {
      setIapLoading(false);
    }
  }, [onCoinsAdded, onMicPassGranted, setHasMicPass, listenersCallbacks]);

  // Pull-to-refresh on the Coins tab: re-fetches balance + purchase summary from DB
  const handleRefreshCoins = useCallback(async () => {
    setRefreshingCoins(true);
    await Promise.all([
      fetchBalance(),
      dispatch(fetchCoinBalance()),
      dispatch(fetchPurchaseSummary()),
    ]);
    setRefreshingCoins(false);
  }, [fetchBalance, dispatch]);

  useEffect(() => {
    if (visible) {
      // Pre-populate balance from Redux so the row shows instantly
      if (coinBalance != null) setBalance(coinBalance);
      void fetchBalance();
      void dispatch(fetchTrackThemes());
      void dispatch(fetchPurchaseSummary());
      void loadProducts();
      // Preload the rewarded ad so it's ready when the user taps "Earn Free Coins"
      preloadRewardedAd();
      // Note: purchase listeners are attached inside loadProducts() after
      // initConnection() resolves — do NOT attach them here synchronously.
    } else {
      // Remove listeners when modal closes; connection stays alive
      cleanupListenersRef.current?.();
      cleanupListenersRef.current = null;
    }
  }, [visible, fetchBalance, dispatch, coinBalance, loadProducts]);

  // ── Earn Free Coins via rewarded ad ────────────────────────────────────────
  const handleEarnFreeCoins = useCallback(async () => {
    if (watchingAd) return;

    if (!isRewardedAdReady()) {
      if (!isNativeAdsAvailable()) {
        // Running in Expo Go — AdMob native SDK is not bundled
        AppAlert.alert(
          "Ads Not Available",
          "Rewarded ads require the installed app build. They are not supported in Expo Go.\n\nBuild the app with EAS to enable this feature.",
        );
      } else {
        // Module loaded but ad hasn't finished loading yet
        AppAlert.alert(
          "Ad Not Ready",
          "The ad is still loading. Please wait a moment and try again.",
        );
        preloadRewardedAd();
      }
      return;
    }

    setWatchingAd(true);
    try {
      const result = await showRewardedAdForCoins(async () => {
        const res = await authFetch("/api/coins/ad-reward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localDate: getLocalDateStr() }),
        });
        const data = await res.json() as {
          success?: boolean;
          coins_awarded?: number;
          new_balance?: number;
          ads_today?: number;
          ads_remaining?: number;
          error?: string;
          code?: string;
        };

        if (!res.ok) {
          if (data.code === "AD_REWARD_LIMIT") {
            AppAlert.alert("Limit Reached", data.error ?? "You've reached today's ad reward limit.");
          } else {
            AppAlert.alert("Error", data.error ?? "Failed to claim coins.");
          }
          return;
        }

        const awarded = data.coins_awarded ?? 0;
        if (awarded > 0) {
          if (data.new_balance != null) setBalance(data.new_balance);
          setAdsToday(data.ads_today ?? 0);
          onCoinsAdded?.();
          void dispatch(fetchCoinBalance());
          AppAlert.alert(
            "🎉 Coins Earned!",
            `+${awarded} coins added to your balance! (${data.ads_remaining ?? 0} ads remaining today)`,
          );
        }
      });

      if (result === "skipped") {
        AppAlert.alert("Ad Skipped", "Watch the full ad to earn coins.");
      }
    } finally {
      setWatchingAd(false);
    }
  }, [watchingAd, onCoinsAdded, dispatch]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupListenersRef.current?.();
      void cleanupIAP();
    };
  }, []);

  // Show theme purchase errors
  useEffect(() => {
    if (purchaseError) {
      AppAlert.alert("Purchase Failed", purchaseError);
      dispatch(clearPurchaseError());
    }
  }, [purchaseError, dispatch]);

  // Debug — log only when themes data or balance actually changes, not on every render.
  useEffect(() => {
    if (!__DEV__ || themes.length === 0) return;
    const owned   = themes.filter((t) => t.owned).length;
    const locked  = themes.filter((t) => t.locked).length;
    const equipped = themes.find((t) => t.isEquipped);
    console.log("[ShopThemes] response count:", themes.length, "owned:", owned, "locked:", locked, "selected:", equipped?.code ?? "none");
    if (balance !== null) console.log("[ShopThemes] coin balance updated:", balance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes, balance]);

  // ── Coin pack purchase ─────────────────────────────────────────────────────
  const handleBuy = async (productId: string) => {
    if (buyingProductId) return; // prevent double-tap
    setBuyingProductId(productId);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await purchaseProduct(productId);
      // Result handled in setupPurchaseListeners → onCoinPurchase / onError
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      // Silently ignore user cancellations
      if (!msg.toLowerCase().includes("cancel")) {
        setBuyingProductId(null);
        AppAlert.alert("Purchase Failed", "Could not start purchase. Please try again.");
      } else {
        setBuyingProductId(null);
      }
    }
  };

  // ── Mic Pass purchase ──────────────────────────────────────────────────────
  const handleBuyMicPass = async () => {
    if (hasMicPass || buyingProductId) return;
    setBuyingProductId(MIC_PASS_PRODUCT_ID);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await purchaseProduct(MIC_PASS_PRODUCT_ID);
      // Result handled in setupPurchaseListeners → onMicPassGrant / onError
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (!msg.toLowerCase().includes("cancel")) {
        setBuyingProductId(null);
        AppAlert.alert("Purchase Failed", "Could not start purchase. Please try again.");
      } else {
        setBuyingProductId(null);
      }
    }
  };

  // ── Restore Mic Pass ───────────────────────────────────────────────────────
  const handleRestorePurchases = async () => {
    if (restoringMic) return;
    setRestoringMic(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await restoreMicPass({
      onSuccess: () => {
        setHasMicPass(true);
        onMicPassGranted?.();
        void fetchMicEntitlement();
        AppAlert.alert("Restored", "Mic Pass has been restored to your account.");
      },
      onNothingToRestore: () => {
        AppAlert.alert("Nothing to Restore", "No Mic Pass purchase was found for this account.");
      },
      onError: (msg) => {
        AppAlert.alert("Restore Failed", msg);
      },
    });
    setRestoringMic(false);
  };

  const handleUnlock = async (code: string) => {
    if (__DEV__) console.log("[ShopThemes] unlock clicked:", code);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await dispatch(purchaseTrackTheme(code));
    if (purchaseTrackTheme.fulfilled.match(result)) {
      if (__DEV__) console.log("[ShopThemes] unlock success:", code, "balance:", result.payload.coinBalance);
      setBalance(result.payload.coinBalance);
    } else {
      if (__DEV__) console.log("[ShopThemes] unlock failed:", result.payload);
    }
  };

  const handleEquip = async (code: string) => {
    if (__DEV__) console.log("[ShopThemes] select clicked:", code);
    const result = await dispatch(equipTrackTheme(code));
    if (equipTrackTheme.fulfilled.match(result)) {
      if (__DEV__) console.log("[ShopThemes] select success:", code);
    } else {
      if (__DEV__) console.log("[ShopThemes] select failed:", code);
      AppAlert.alert("Error", "Could not select theme. Please try again.");
    }
  };

  const handleRefreshThemes = () => {
    if (__DEV__) console.log("[ShopThemes] fetching themes");
    void dispatch(fetchTrackThemes());
  };

  // Sort: equipped → owned → locked; locked themes sorted by priceCoins ascending (cheapest first)
  const sortedThemes = useMemo<TrackTheme[]>(() => [...themes].sort((a, b) => {
    const rank = (t: TrackTheme) => t.isEquipped ? 0 : t.owned ? 1 : 2;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.locked && b.locked) return a.priceCoins - b.priceCoins;
    return a.sortOrder - b.sortOrder;
  }), [themes]);

  // Shop only shows themes the user does NOT yet own
  const lockedThemes = useMemo(() => sortedThemes.filter((t) => t.locked), [sortedThemes]);

  // Mic Pass localized price from store, fallback to display placeholder
  const micPassPrice = premiumProduct?.localizedPrice ?? null;
  const buyingMic = buyingProductId === MIC_PASS_PRODUCT_ID;

  const storeContent = (
    <View style={s.root}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Image source={shopImage} style={s.headerIcon} resizeMode="contain" />
        <View style={s.headerTextWrap}>
          <Text style={s.headerTitle}>Coins Store</Text>
          <Text style={s.headerSub}>Buy coins to unlock race tracks and premium themes</Text>
        </View>
        {!standalone && (
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.closeBtn}>
            <Feather name="x" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

        {/* ── Tab bar ── */}
        <View style={s.tabBar}>
          {(["coins", "themes", "premium"] as ShopTab[]).map((tab) => {
            const isActive = activeTab === tab;
            const accent =
              tab === "coins"   ? "#FFD700" :
              tab === "themes"  ? "#A855F7" : "#F59E0B";
            const label =
              tab === "themes"  ? "🎨 Themes" : "⭐ Premium";
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  s.tabBtn,
                  isActive && { backgroundColor: accent + "22", borderColor: accent + "55", borderWidth: 1 },
                ]}
                onPress={() => {
                  setActiveTab(tab);
                  if (tab === "themes") handleRefreshThemes();
                }}
                activeOpacity={0.8}
              >
                {tab === "coins" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <CoinIcon size={14} />
                    <Text style={[s.tabTxt, isActive && { color: accent, fontWeight: "800" }]}>Coins</Text>
                  </View>
                ) : (
                  <Text style={[s.tabTxt, isActive && { color: accent, fontWeight: "800" }]}>
                    {label}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Balance banner ── */}
        <View style={s.balanceRow}>
          <CoinIcon size="medium" />
          <Text style={s.balanceLabel}>Your Balance</Text>
          <Text style={s.balanceValue}>{(balance ?? coinBalance)?.toLocaleString() ?? "--"}</Text>
        </View>

        {/* ══ COINS TAB ══════════════════════════════════════════════════════ */}
        {activeTab === "coins" && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.scroll, { paddingBottom: scrollBottomPad }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshingCoins}
                onRefresh={handleRefreshCoins}
                tintColor="#FFD700"
              />
            }
          >
            <Text style={s.sectionLabel}>COIN PACKS</Text>

            {/* IAP loading state */}
            {iapLoading && coinProducts.length === 0 && (
              <View style={s.iapLoadingRow}>
                <ActivityIndicator size="small" color="#FFD700" />
                <Text style={s.iapLoadingTxt}>Loading prices…</Text>
              </View>
            )}

            {/* IAP error with retry */}
            {iapError && coinProducts.length === 0 && (
              <View style={s.iapErrorCard}>
                <Feather name="alert-circle" size={20} color="#F87171" />
                <Text style={s.iapErrorTxt}>{iapError}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={loadProducts} activeOpacity={0.8}>
                  <Text style={s.retryTxt}>Try Again</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Coin pack rows — live store products when available, skeleton-style fallback while loading */}
            {(coinProducts.length > 0 ? coinProducts : iapLoading ? [] : COIN_PACK_FALLBACKS).map((pack) => {
              const liveProduct = coinProducts.find((p) => p.productId === pack.productId);
              const priceLabel = liveProduct?.localizedPrice ?? null;
              const isBuying = buyingProductId === pack.productId;
              const isDisabled = !!buyingProductId || iapLoading;

              return (
                <View key={pack.productId} style={s.packCard}>
                  <CoinIcon size="large" />
                  <View style={s.packTextCol}>
                    <Text style={s.packCoins}>{pack.coins.toLocaleString()} Coins</Text>
                    <Text style={s.packSub}>One-time purchase</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.priceBtn, (!priceLabel || isDisabled) && s.priceBtnDim]}
                    onPress={() => { if (priceLabel) void handleBuy(pack.productId); }}
                    disabled={!priceLabel || isDisabled}
                    activeOpacity={0.82}
                  >
                    {isBuying ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : priceLabel ? (
                      <Text style={s.priceBtnText}>{priceLabel}</Text>
                    ) : (
                      <ActivityIndicator size="small" color="#6B7280" />
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}

            <TouchableOpacity
              style={[s.freeCard, watchingAd && { opacity: 0.6 }]}
              activeOpacity={0.85}
              onPress={() => { void handleEarnFreeCoins(); }}
              disabled={watchingAd}
            >
              <View style={[s.freeIconCircle, { backgroundColor: "#22C55E20" }]}>
                {watchingAd
                  ? <ActivityIndicator size="small" color="#22C55E" />
                  : <Feather name="play-circle" size={22} color="#22C55E" />
                }
              </View>
              <View style={s.freeTextCol}>
                <Text style={s.freeTitle}>Earn Free Coins</Text>
                <Text style={s.freeSub}>
                  {adsToday >= 5
                    ? "Daily limit reached — come back tomorrow!"
                    : `Watch a short ad to earn +30 coins (${5 - adsToday} left today)`}
                </Text>
              </View>
              {!watchingAd && <Feather name="chevron-right" size={18} color="#6B7280" />}
            </TouchableOpacity>

            {/* ── Purchase stats banner ── */}
            {purchaseSummary && purchaseSummary.iap.totalPurchases > 0 && (
              <View style={s.statsBanner}>
                <View style={s.statsBannerItem}>
                  <Text style={s.statsBannerNum}>{purchaseSummary.iap.totalPurchases}</Text>
                  <Text style={s.statsBannerLabel}>Purchases</Text>
                </View>
                <View style={s.statsBannerDivider} />
                <View style={s.statsBannerItem}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <CoinIcon size="small" />
                    <Text style={s.statsBannerNum}>{purchaseSummary.iap.totalCoinsPurchased.toLocaleString()}</Text>
                  </View>
                  <Text style={s.statsBannerLabel}>Coins Bought</Text>
                </View>
                {purchaseSummary.iap.hasMicPass && (
                  <>
                    <View style={s.statsBannerDivider} />
                    <View style={s.statsBannerItem}>
                      <Feather name="mic" size={16} color="#A855F7" />
                      <Text style={[s.statsBannerLabel, { color: "#A855F7" }]}>Mic Pass</Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {/* ── Purchase history ── */}
            {summaryLoading && !purchaseSummary && (
              <View style={s.historyLoading}>
                <ActivityIndicator size="small" color="#6B7280" />
                <Text style={s.historyLoadingTxt}>Loading history…</Text>
              </View>
            )}
            {purchaseSummary && purchaseSummary.purchaseHistory.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 16 }]}>RECENT PURCHASES</Text>
                {purchaseSummary.purchaseHistory.map((item: PurchaseHistoryItem) => (
                  <View key={item.id} style={s.historyRow}>
                    <View style={[s.historyIcon, item.isMicPass ? s.historyIconMic : s.historyIconCoin]}>
                      {item.isMicPass
                        ? <Feather name="mic" size={15} color="#A855F7" />
                        : <CoinIcon size={15} />
                      }
                    </View>
                    <View style={s.historyText}>
                      <Text style={s.historyName}>{item.displayName}</Text>
                      <Text style={s.historyDate}>
                        {item.platform === "ios" ? "App Store" : item.platform === "android" ? "Google Play" : item.platform}
                        {" · "}
                        {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </Text>
                    </View>
                    {item.coinAmount != null
                      ? <View style={s.historyCoinsRow}><CoinIcon size="small" /><Text style={s.historyCoinsText}>+{item.coinAmount.toLocaleString()}</Text></View>
                      : <View style={s.historyMicBadge}><Text style={s.historyMicBadgeTxt}>LIFETIME</Text></View>
                    }
                  </View>
                ))}
              </>
            )}
            {purchaseSummary && purchaseSummary.purchaseHistory.length === 0 && (
              <View style={s.historyEmpty}>
                <Feather name="shopping-bag" size={20} color="#2A2A3A" />
                <Text style={s.historyEmptyTxt}>No purchases yet</Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* ══ THEMES TAB ═════════════════════════════════════════════════════ */}
        {activeTab === "themes" && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.scroll, { paddingBottom: scrollBottomPad }]}
            refreshControl={
              <RefreshControl refreshing={themesLoading} onRefresh={handleRefreshThemes} tintColor="#22C55E" />
            }
          >
            <BannerAdView style={{ marginBottom: 14 }} />
            {themesLoading && sortedThemes.length === 0 ? (
              <View style={s.themesGrid}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={{ width: "47.8%", backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                    <View style={{ width: "100%", height: 88, backgroundColor: colors.muted }} />
                    <View style={{ padding: 8 }}>
                      <View style={{ height: 11, backgroundColor: colors.border, borderRadius: 6, width: "60%", marginBottom: 10 }} />
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ height: 18, backgroundColor: colors.border, borderRadius: 6, width: "35%" }} />
                        <View style={{ height: 24, backgroundColor: colors.border, borderRadius: 8, width: "42%" }} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : themesError && sortedThemes.length === 0 ? (
              <View style={s.center}>
                <Feather name="alert-circle" size={36} color="#EF4444" />
                <Text style={s.errorTxt}>Could not load track themes.</Text>
                <Text style={s.errorHint}>Pull to refresh.</Text>
              </View>
            ) : lockedThemes.length === 0 && sortedThemes.length > 0 ? (
              <View style={s.center}>
                <Feather name="check-circle" size={40} color="#22C55E" />
                <Text style={s.allOwnedTxt}>You've unlocked all track themes!</Text>
              </View>
            ) : (
              <>
                <View style={s.themesHeaderRow}>
                  <Text style={s.sectionLabel}>AVAILABLE TO UNLOCK</Text>
                  <Text style={s.themesCount}>{lockedThemes.length} themes</Text>
                </View>
                <View style={s.themesGrid}>
                  {lockedThemes.map((theme) => (
                    <ThemeCard
                      key={theme.code}
                      theme={theme}
                      onUnlock={handleUnlock}
                      onEquip={handleEquip}
                    />
                  ))}
                </View>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}

        {/* ══ PREMIUM TAB ════════════════════════════════════════════════════ */}
        {activeTab === "premium" && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, { paddingBottom: scrollBottomPad }]}>
            {ENABLE_MIC_PASS && (
              <View style={s.micCard}>
                {!hasMicPass && (
                  <View style={s.micDiscBadge}><Text style={s.micDiscText}>LIFETIME</Text></View>
                )}
                <LinearGradient colors={["#2D1064", "#4C1D95"]} style={s.micGrad}>
                  <View style={s.micIconCircle}><Feather name="mic" size={22} color="#fff" /></View>
                  <View style={s.micInfo}>
                    <Text style={s.micTitle}>Mic Pass</Text>
                    <Text style={s.micSub}>{hasMicPass ? "Active forever · All races" : "Talk during live races"}</Text>
                    {!hasMicPass && <Text style={s.micPromo}>One-time purchase · Never expires</Text>}
                  </View>
                  <View style={s.micRight}>
                    {loadingMic ? (
                      <ActivityIndicator size="small" color="#A855F7" />
                    ) : hasMicPass ? (
                      <View style={s.ownedBadge}>
                        <Feather name="check-circle" size={14} color="#22C55E" />
                        <Text style={s.ownedText}>Owned</Text>
                      </View>
                    ) : (
                      <View style={s.micPriceCol}>
                        <TouchableOpacity
                          style={[s.micBuyBtn, (buyingMic || !micPassPrice) && s.micBuyBtnDim]}
                          onPress={handleBuyMicPass}
                          disabled={buyingMic || !micPassPrice || !!buyingProductId}
                          activeOpacity={0.8}
                        >
                          {buyingMic ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : micPassPrice ? (
                            <Text style={s.micBuyText}>{micPassPrice}</Text>
                          ) : (
                            <ActivityIndicator size="small" color="#A855F7" />
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </LinearGradient>
                {hasMicPass && (
                  <View style={s.micActiveBar}>
                    <Feather name="check-circle" size={13} color="#22C55E" />
                    <Text style={s.micActiveText}>Mic Pass Active — Voice chat enabled in all races</Text>
                  </View>
                )}

                {/* Restore Purchases — only shown when Mic Pass not yet owned */}
                {!hasMicPass && (
                  <TouchableOpacity
                    style={s.restoreBtn}
                    onPress={handleRestorePurchases}
                    disabled={restoringMic}
                    activeOpacity={0.7}
                  >
                    {restoringMic ? (
                      <ActivityIndicator size="small" color="#A855F7" />
                    ) : (
                      <Text style={s.restoreTxt}>Restore Purchases</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
            {!ENABLE_MIC_PASS && (
              <View style={s.center}>
                <Feather name="star" size={36} color="#6B7280" />
                <Text style={s.loadingTxt}>More premium items coming soon!</Text>
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
  );

  if (standalone) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background, paddingBottom: tabBarHeight }}
      >
        {storeContent}
      </SafeAreaView>
    );
  }
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {storeContent}
    </Modal>
  );
}

function makeStoreStyles(c: ReturnType<typeof useColors>) {
  return {
    root:           { flex: 1, backgroundColor: c.background },
    header:         { flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    headerIcon:     { width: 48, height: 48 },
    headerTextWrap: { flex: 1 },
    headerTitle:    { fontSize: 22, fontWeight: "800" as const, color: c.foreground },
    headerSub:      { fontSize: 12, color: c.mutedForeground, marginTop: 3, lineHeight: 17 },
    closeBtn:       { width: 32, height: 32, borderRadius: 16, backgroundColor: c.muted, alignItems: "center" as const, justifyContent: "center" as const },
    tabBar:         { flexDirection: "row" as const, marginHorizontal: 20, marginTop: 14, marginBottom: 4, backgroundColor: c.muted, borderRadius: 12, padding: 3 },
    tabBtn:         { flex: 1, paddingVertical: 9, alignItems: "center" as const, borderRadius: 10 },
    tabBtnActive:   { backgroundColor: c.secondary },
    tabTxt:         { fontSize: 13, fontWeight: "600" as const, color: c.mutedForeground },
    tabTxtActive:   { color: c.foreground, fontWeight: "800" as const },
    balanceRow:     { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, marginHorizontal: 20, marginTop: 10, marginBottom: 4, backgroundColor: c.muted, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 16, paddingVertical: 12 },
    balanceLabel:   { flex: 1, fontSize: 13, color: c.mutedForeground },
    balanceValue:   { fontSize: 20, fontWeight: "900" as const, color: "#FFD700" },
    scroll:         { paddingHorizontal: 20, paddingTop: 16 },
    sectionLabel:   { fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.1, color: c.mutedForeground, marginBottom: 12 },
    iapLoadingRow:  { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingVertical: 12 },
    iapLoadingTxt:  { fontSize: 13, color: c.mutedForeground },
    iapErrorCard:   { alignItems: "center" as const, gap: 10, backgroundColor: c.card, borderRadius: 14, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: "#F8717130" },
    iapErrorTxt:    { fontSize: 13, color: "#F87171", textAlign: "center" as const },
    retryBtn:       { backgroundColor: "#7C3AED", paddingHorizontal: 20, paddingVertical: 9, borderRadius: 10 },
    retryTxt:       { fontSize: 13, fontWeight: "700" as const, color: "#fff" },
    packCard:       { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 10, gap: 12 },
    packTextCol:    { flex: 1, gap: 2 },
    packCoins:      { fontSize: 17, fontWeight: "800" as const, color: "#FFD700" },
    packSub:        { fontSize: 11, color: c.mutedForeground },
    packBadge:      { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, marginRight: 4 },
    packBadgeGreen: { backgroundColor: "#14532D" },
    packBadgeGold:  { backgroundColor: "#78350F" },
    packBadgeText:  { fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.3 },
    priceBtn:       { backgroundColor: "#22C55E", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, minWidth: 68, alignItems: "center" as const, justifyContent: "center" as const },
    priceBtnDim:    { backgroundColor: c.muted },
    priceBtnText:   { fontSize: 14, fontWeight: "900" as const, color: "#000" },
    freeCard:       { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: "#22C55E30", padding: 16, gap: 14, marginTop: 6, marginBottom: 8 },
    freeIconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#0B2A1A", alignItems: "center" as const, justifyContent: "center" as const, flexShrink: 0 },
    freeTextCol:    { flex: 1, gap: 3 },
    freeTitle:      { fontSize: 15, fontWeight: "700" as const, color: "#22C55E" },
    freeSub:        { fontSize: 12, color: c.mutedForeground, lineHeight: 17 },
    themesHeaderRow:{ flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginBottom: 12 },
    themesCount:    { fontSize: 12, color: c.mutedForeground },
    themesGrid:     { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 10 },
    center:         { alignItems: "center" as const, justifyContent: "center" as const, paddingVertical: 60, gap: 12 },
    loadingTxt:     { fontSize: 14, color: c.mutedForeground, marginTop: 4 },
    errorTxt:       { fontSize: 15, fontWeight: "600" as const, color: "#EF4444" },
    errorHint:      { fontSize: 13, color: c.mutedForeground },
    allOwnedTxt:    { fontSize: 15, fontWeight: "700" as const, color: "#22C55E", textAlign: "center" as const },
    micCard:        { borderRadius: 18, overflow: "hidden" as const, marginBottom: 20, borderWidth: 1, borderColor: "#7C3AED40" },
    micDiscBadge:   { position: "absolute" as const, top: 0, right: 14, backgroundColor: "#7C3AED", paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, zIndex: 2 },
    micDiscText:    { color: "#fff", fontSize: 11, fontWeight: "900" as const, letterSpacing: 0.5 },
    micGrad:        { flexDirection: "row" as const, alignItems: "center" as const, padding: 18, paddingTop: 22, gap: 14 },
    micIconCircle:  { width: 52, height: 52, borderRadius: 16, backgroundColor: "#7C3AED", alignItems: "center" as const, justifyContent: "center" as const, flexShrink: 0 },
    micInfo:        { flex: 1, gap: 3 },
    micTitle:       { fontSize: 18, fontWeight: "800" as const, color: c.foreground },
    micSub:         { fontSize: 13, color: "#C4B5FD" },
    micPromo:       { fontSize: 11, color: "#A78BFA", fontWeight: "700" as const },
    micRight:       { alignItems: "flex-end" as const, gap: 4 },
    micPriceCol:    { alignItems: "flex-end" as const, gap: 6 },
    micOldPrice:    { fontSize: 13, color: c.mutedForeground, textDecorationLine: "line-through" as const },
    micBuyBtn:      { backgroundColor: "#7C3AED", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, minWidth: 72, alignItems: "center" as const },
    micBuyBtnDim:   { backgroundColor: "#3D1A6E" },
    micBuyText:     { color: "#fff", fontSize: 15, fontWeight: "900" as const },
    ownedBadge:     { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, backgroundColor: "#0B2A1A", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#22C55E30" },
    ownedText:      { color: "#22C55E", fontSize: 13, fontWeight: "800" as const },
    micActiveBar:   { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, backgroundColor: "#0B2A1A", paddingHorizontal: 16, paddingVertical: 10 },
    micActiveText:  { fontSize: 12, color: "#4ADE80", flex: 1 },
    restoreBtn:     { alignItems: "center" as const, paddingVertical: 14, backgroundColor: c.muted },
    restoreTxt:     { fontSize: 13, color: "#A855F7", fontWeight: "600" as const },
    statsBanner:        { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-around" as const, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingVertical: 14, paddingHorizontal: 10, marginTop: 8 },
    statsBannerItem:    { alignItems: "center" as const, gap: 4, flex: 1 },
    statsBannerNum:     { fontSize: 18, fontWeight: "900" as const, color: "#FFD700" },
    statsBannerLabel:   { fontSize: 11, color: c.mutedForeground },
    statsBannerDivider: { width: 1, height: 30, backgroundColor: c.border },
    historyLoading:    { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 14, justifyContent: "center" as const },
    historyLoadingTxt: { fontSize: 12, color: c.mutedForeground },
    historyRow:        { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
    historyIcon:       { width: 36, height: 36, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const },
    historyIconCoin:   { backgroundColor: c.muted },
    historyIconMic:    { backgroundColor: "#2D1064" },
    historyText:       { flex: 1, gap: 2 },
    historyName:       { fontSize: 13, fontWeight: "700" as const, color: c.foreground },
    historyDate:       { fontSize: 11, color: c.mutedForeground },
    historyCoinsRow:   { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
    historyCoinsText:  { fontSize: 13, fontWeight: "800" as const, color: "#FFD700" },
    historyMicBadge:   { backgroundColor: "#2D1064", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
    historyMicBadgeTxt:{ fontSize: 10, fontWeight: "800" as const, color: "#A855F7" },
    historyEmpty:      { alignItems: "center" as const, gap: 6, paddingVertical: 20 },
    historyEmptyTxt:   { fontSize: 12, color: c.mutedForeground },
  };
}
