import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import CoinsStoreModal from "@/components/CoinsStoreModal";
import { useAppDispatch } from "@/store/hooks";
import { fetchCoinBalance, fetchPurchaseSummary } from "@/store/slices/coinsSlice";
import { fetchTrackThemes } from "@/store/slices/trackThemesSlice";
import { useColors } from "@/hooks/useColors";

export default function ShopTab() {
  const dispatch = useAppDispatch();
  const colors = useColors();

  const handleCoinsAdded = useCallback(() => {
    dispatch(fetchCoinBalance());
    dispatch(fetchPurchaseSummary());
    dispatch(fetchTrackThemes());
  }, [dispatch]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <CoinsStoreModal
        standalone
        visible={true}
        onClose={() => {}}
        onCoinsAdded={handleCoinsAdded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
