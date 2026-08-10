/**
 * Recurring dimension tokens used across Walk Champ.
 * Sized with rs() where the existing UI already scales; otherwise fixed by design.
 */

import { rs } from "@/utils/responsive";

export const sizes = {
  /** Primary CTA height (common ~48–52 look; keep moderate) */
  buttonHeight: rs(48),
  buttonHeightSm: rs(40),
  inputHeight: rs(48),
  /** Tab bar icon sizes — platform values live in tabs layout; these are defaults */
  iconTabIos: 22,
  iconTabAndroid: 24,
  iconNav: 22,
  iconInline: 16,
  iconChevron: 18,
  /** Avatars */
  avatarXs: rs(24),
  avatarSm: rs(30),
  avatarMd: rs(38),
  avatarLg: rs(48),
  avatarXl: rs(72),
  /** Hit targets */
  hitTarget: 40,
  /** Common radii (unchanged visual language) */
  radiusSm: 10,
  radiusMd: 12,
  radiusLg: 14,
  radiusXl: 18,
  radiusXxl: 20,
  /** Border / hairline — keep fixed */
  hairline: 1,
  /** Shop FAB (DraggableShopIcon) — intentional fixed size */
  shopFab: 47,
} as const;

export type SizeToken = keyof typeof sizes;
