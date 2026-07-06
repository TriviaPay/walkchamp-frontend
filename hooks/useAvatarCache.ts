import { useCallback } from "react";
import { useAvatarVersionContext } from "@/context/AvatarVersionContext";
import { useAuth } from "@/context/AuthContext";
import {
  prefetchProfileAvatar,
  type ProfileAvatarUploadResult,
} from "@/services/mediaApi";
import { screenCache } from "@/utils/screenCache";

export const PROFILE_ME_CACHE_KEY = "screen:profile_me:v1";

/**
 * Professional avatar cache pattern:
 * 1. Local file preview on pick (instant)
 * 2. Version bump on change (cache-bust remote URLs)
 * 3. Redux + disk persist (no refetch needed for self)
 */
export function useAvatarCache() {
  const { publishAvatarVersion, setLocalPreview } = useAvatarVersionContext();
  const { user, updateUser } = useAuth();

  const beginLocalAvatarPick = useCallback(
    (localUri: string) => {
      if (!user?.id) return;
      setLocalPreview(user.id, localUri);
      publishAvatarVersion(user.id, Date.now());
    },
    [user?.id, setLocalPreview, publishAvatarVersion],
  );

  const applyAvatarUploadSuccess = useCallback(
    (result: ProfileAvatarUploadResult) => {
      if (!user?.id) return;
      publishAvatarVersion(user.id, result.avatarVersion);
      void updateUser({
        profileImageUrl: result.avatarUrl || result.displayUrl,
        avatarVersion: result.avatarVersion,
      });
      prefetchProfileAvatar(user.id, result.avatarVersion);
      screenCache.invalidate(PROFILE_ME_CACHE_KEY);
    },
    [user?.id, publishAvatarVersion, updateUser],
  );

  const applyAvatarRemoved = useCallback(
    (avatarVersion: number) => {
      if (!user?.id) return;
      setLocalPreview(user.id, null);
      publishAvatarVersion(user.id, avatarVersion);
      void updateUser({
        profileImageUrl: null,
        avatarVersion,
      });
      screenCache.invalidate(PROFILE_ME_CACHE_KEY);
    },
    [user?.id, setLocalPreview, publishAvatarVersion, updateUser],
  );

  const clearLocalPreviewAfterRemoteLoad = useCallback(
    (userId: string) => {
      setLocalPreview(userId, null);
    },
    [setLocalPreview],
  );

  return {
    beginLocalAvatarPick,
    applyAvatarUploadSuccess,
    applyAvatarRemoved,
    clearLocalPreviewAfterRemoteLoad,
  };
}
