import React, { useEffect, useState } from "react";
import { View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { profileAvatarImageUri, isAvatarUriLoaded, markAvatarUriLoaded } from "@/services/mediaApi";
import { useAvatarVersionContext } from "@/context/AvatarVersionContext";

type CachedAvatarImageProps = {
  userId: string;
  avatarVersion?: number | null;
  size: number;
  style?: ViewStyle;
};

/** Disk-cached remote avatar with live version overrides + local preview support. */
export function CachedAvatarImage({
  userId,
  avatarVersion = 0,
  size,
  style,
}: CachedAvatarImageProps) {
  const { getAvatarVersion, getLocalPreview, setLocalPreview } = useAvatarVersionContext();
  const effectiveVersion = getAvatarVersion(userId, avatarVersion ?? 0);
  const localPreview = getLocalPreview(userId);
  const serverUri = profileAvatarImageUri(userId, effectiveVersion);
  const [remoteReady, setRemoteReady] = useState(() => isAvatarUriLoaded(serverUri));
  const radius = size / 2;

  useEffect(() => {
    setRemoteReady(isAvatarUriLoaded(serverUri));
  }, [effectiveVersion, localPreview, serverUri]);

  const showLocal = !!localPreview && !remoteReady;

  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: "hidden" }, style]}>
      <Image
        source={{ uri: serverUri }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
        transition={0}
        recyclingKey={`avatar-${userId}-${effectiveVersion}`}
        onLoad={() => {
          markAvatarUriLoaded(serverUri);
          setRemoteReady(true);
          setLocalPreview(userId, null);
        }}
      />
      {showLocal ? (
        <Image
          source={{ uri: localPreview }}
          style={{ position: "absolute", top: 0, left: 0, width: size, height: size, borderRadius: radius }}
          contentFit="cover"
          cachePolicy="none"
          transition={0}
        />
      ) : null}
    </View>
  );
}
