import React from "react";
import { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";

type CoinSizeKey = "xs" | "small" | "medium" | "large" | "xl";

const SIZES: Record<CoinSizeKey, number> = {
  xs:     12,
  small:  16,
  medium: 22,
  large:  32,
  xl:     44,
};

const coinAsset = require("@/assets/images/game-coin.png");

interface Props {
  size?: CoinSizeKey | number;
  style?: StyleProp<ImageStyle>;
}

export default function CoinIcon({ size = "medium", style }: Props) {
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    <Image
      source={coinAsset}
      style={[{ width: px, height: px, flexShrink: 0 }, style]}
      contentFit="contain"
      cachePolicy="memory"
      transition={0}
    />
  );
}
