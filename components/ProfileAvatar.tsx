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
 * Shared avatar component — single source of truth for profile picture display.
 *
 * - Tries the proxy URL whenever userId is known (profileImageUrl is optional).
 * - Falls back to initials when load fails or no userId.
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
  const { getAvatarVersion } = useAvatarVersionContext();
  const [loadFailed, setLoadFailed] = useState(false);
  const initials = displayName.trim() ? displayName.trim().charAt(0).toUpperCase() : "?";

  const effectiveVersion = userId ? getAvatarVersion(userId, avatarVersion ?? 0) : (avatarVersion ?? 0);
  const tryImage = !!userId && !loadFailed;
  const imageUri = tryImage
    ? profileAvatarImageUri(userId, effectiveVersion)
    : null;

  useEffect(() => {
    setLoadFailed(false);
  }, [userId, effectiveVersion, profileImageUrl]);

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

  const inner = imageUri ? (
    <Image
      source={{ uri: imageUri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => setLoadFailed(true)}
    />
  ) : (
    <Text style={[styles.initials, { color: avatarColor, fontSize: size * 0.38 }]}>
      {initials}
    </Text>
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
