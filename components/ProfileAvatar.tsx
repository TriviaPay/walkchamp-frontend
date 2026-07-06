import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { profileAvatarImageUri } from "@/services/mediaApi";
import { useAvatarVersionContext } from "@/context/AvatarVersionContext";

interface ProfileAvatarProps {
  userId?: string | null;
  profileImageUrl?: string | null;
  avatarVersion?: number | null;
  avatarColor?: string;
  displayName?: string;
  size?: number;
  borderWidth?: number;
  onPress?: () => void;
  style?: ViewStyle;
}

/**
 * Shared avatar — initials instantly, local pick preview instantly,
 * remote URL keyed by avatarVersion (immutable CDN cache).
 */
export function ProfileAvatar({
  userId,
  profileImageUrl,
  avatarVersion,
  avatarColor = "#00E676",
  displayName = "",
  size = 48,
  borderWidth = 2,
  onPress,
  style,
}: ProfileAvatarProps) {
  const { getAvatarVersion, getLocalPreview, setLocalPreview } = useAvatarVersionContext();
  const [loadFailed, setLoadFailed] = useState(false);
  const initials = displayName.trim() ? displayName.trim().charAt(0).toUpperCase() : "?";

  const effectiveVersion = userId ? getAvatarVersion(userId, avatarVersion ?? 0) : (avatarVersion ?? 0);
  const localPreview = userId ? getLocalPreview(userId) : null;
  const serverUri =
    userId && profileImageUrl && !loadFailed
      ? profileAvatarImageUri(userId, effectiveVersion)
      : null;
  const [remoteReady, setRemoteReady] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
    setRemoteReady(false);
  }, [userId, effectiveVersion, profileImageUrl, localPreview]);

  const showLocal = !!localPreview && !remoteReady;
  const showPhoto = showLocal || !!serverUri;

  const containerStyle: ViewStyle[] = [
    styles.container,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: avatarColor + "30",
      borderColor: avatarColor,
      borderWidth,
    },
    ...(style ? [style] : []),
  ];

  const inner = (
    <>
      <Text style={[styles.initials, { color: avatarColor, fontSize: size * 0.38 }]}>
        {initials}
      </Text>
      {serverUri ? (
        <Image
          source={{ uri: serverUri }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: size / 2 }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={`avatar-${userId}-${effectiveVersion}`}
          onError={() => setLoadFailed(true)}
          onLoad={() => {
            setRemoteReady(true);
            if (userId) setLocalPreview(userId, null);
          }}
        />
      ) : null}
      {showLocal ? (
        <Image
          source={{ uri: localPreview! }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: size / 2 }]}
          contentFit="cover"
          cachePolicy="none"
          transition={0}
        />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={containerStyle} onPress={onPress} activeOpacity={0.8}>
        {inner}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{inner}</View>;
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: {
    fontWeight: "800",
  },
});
