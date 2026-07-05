import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PublicProfileModal } from "@/components/PublicProfileModal";

/** Deep-link target for friend activity and profile pushes (`/public-profile/{userId}`). */
export default function PublicProfileDeepLinkScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string | string[] }>();
  const id = Array.isArray(userId) ? userId[0] : userId;

  return (
    <View style={{ flex: 1, backgroundColor: "transparent" }}>
      <PublicProfileModal
        visible={!!id}
        userId={id ?? null}
        onClose={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/walk");
        }}
      />
    </View>
  );
}
