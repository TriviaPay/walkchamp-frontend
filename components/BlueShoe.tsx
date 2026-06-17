import { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";

const shoeAsset = require("../assets/images/blue-shoe.png");

export function BlueShoe({ size = 14, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={shoeAsset}
      style={[{ width: size, height: size }, style]}
      contentFit="contain"
      cachePolicy="memory"
      transition={0}
    />
  );
}
