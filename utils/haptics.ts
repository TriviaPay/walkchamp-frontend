import * as ExpoHaptics from "expo-haptics";

export { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";

let _enabled = true;

export function setHapticsEnabled(v: boolean) {
  _enabled = v;
}

export const impactAsync = (style: ExpoHaptics.ImpactFeedbackStyle): Promise<void> => {
  if (!_enabled) return Promise.resolve();
  return ExpoHaptics.impactAsync(style).catch(() => {});
};

export const notificationAsync = (type: ExpoHaptics.NotificationFeedbackType): Promise<void> => {
  if (!_enabled) return Promise.resolve();
  return ExpoHaptics.notificationAsync(type).catch(() => {});
};
