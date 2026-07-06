/**
 * Profile avatars, group images, and track theme images — API upload + display URLs.
 * Backend handles R2; frontend never uploads directly to storage.
 */
import { Platform } from "react-native";
import { getApiBase } from "@/utils/apiUrl";
import { getValidSession } from "@/services/authService";
import { authFetch } from "@/utils/authFetch";

export type ProfileAvatarUploadResult = {
  /** Raw R2 public URL — store on profile as profileImageUrl / avatarUrl */
  avatarUrl: string;
  /** API image route path, e.g. /api/profile/avatar/:userId */
  displayUrl: string;
  avatarVersion: number;
  /** Full URI for <Image source={{ uri }} /> */
  imageUri: string;
};

export type GroupImageUploadResult = {
  displayUrl: string;
  imageVersion: number;
  imageUri: string;
};

/** `${API_URL}${displayUrl}?v=${version}` */
export function buildApiImageUri(displayPath: string, version?: number): string {
  const base = getApiBase().replace(/\/$/, "");
  const path = displayPath.startsWith("http")
    ? displayPath
    : `${base}${displayPath.startsWith("/") ? displayPath : `/${displayPath}`}`;
  if (version === undefined || version === null) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}v=${version}`;
}

export function profileAvatarImageUri(userId: string, avatarVersion = 0): string {
  return `${getApiBase()}/api/profile/avatar/${userId}?v=${avatarVersion}`;
}

/** Warm disk cache for avatars — call after login or list fetch. */
export function prefetchProfileAvatar(userId: string, avatarVersion = 0): void {
  if (!userId) return;
  void import("expo-image").then(({ Image }) => {
    void Image.prefetch(profileAvatarImageUri(userId, avatarVersion), {
      cachePolicy: "memory-disk",
    });
  });
}

export function prefetchProfileAvatars(
  entries: Array<{ userId: string; avatarVersion?: number | null; avatarUrl?: string | null }>,
): void {
  for (const e of entries) {
    if (e.userId && e.avatarUrl) {
      prefetchProfileAvatar(e.userId, e.avatarVersion ?? 0);
    }
  }
}

export function groupImageUri(groupId: string, imageVersion = 0): string {
  return `${getApiBase()}/api/groups/${groupId}/image?v=${imageVersion}`;
}

export function trackThemeImageUri(code: string, version?: number): string {
  const url = `${getApiBase()}/api/track-themes/${code}/image`;
  return version != null ? `${url}?v=${version}` : url;
}

async function postMultipart<T>(
  url: string,
  formData: FormData,
  session: string,
): Promise<T> {
  if (Platform.OS === "web") {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}` },
      body: formData,
    });
    return (await res.json()) as T;
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${session}`);
    // Do not set Content-Type — fetch/XHR must set multipart boundary automatically.
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        reject(new Error("Bad response"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}

function appendImageToForm(
  form: FormData,
  fieldName: string,
  uri: string,
  mimeType: string,
  fileBaseName: string,
): void {
  const ext = mimeType.split("/")[1] ?? "jpg";
  form.append(
    fieldName,
    { uri, name: `${fileBaseName}.${ext}`, type: mimeType } as unknown as Blob,
  );
}

/** POST /api/profile/me/avatar — field name: avatar */
export async function uploadProfileAvatar(
  uri: string,
  mimeType = "image/jpeg",
): Promise<ProfileAvatarUploadResult | null> {
  const session = await getValidSession();
  if (!session) return null;

  const form = new FormData();
  const ext = mimeType.split("/")[1] ?? "jpg";
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("avatar", blob, `avatar.${ext}`);
  } else {
    appendImageToForm(form, "avatar", uri, mimeType, "avatar");
  }

  const json = await postMultipart<{
    success?: boolean;
    avatarUrl?: string;
    displayUrl?: string;
    avatarVersion?: number;
  }>(`${getApiBase()}/api/profile/me/avatar`, form, session);

  if (!json.success || !json.displayUrl) return null;

  const avatarVersion =
    typeof json.avatarVersion === "number" ? json.avatarVersion : 0;

  return {
    avatarUrl: String(json.avatarUrl ?? ""),
    displayUrl: json.displayUrl,
    avatarVersion,
    imageUri: buildApiImageUri(json.displayUrl, avatarVersion),
  };
}

/** DELETE /api/profile/me/avatar */
export async function deleteProfileAvatar(): Promise<{
  success: boolean;
  avatarVersion?: number;
}> {
  try {
    const res = await authFetch(`/api/profile/me/avatar`, { method: "DELETE" });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      avatarVersion?: number;
    };
    return {
      success: !!json.success && res.ok,
      avatarVersion: json.avatarVersion,
    };
  } catch {
    return { success: false };
  }
}

/** POST /api/groups/:groupId/image — field name: image */
export async function uploadGroupImage(
  groupId: string,
  uri: string,
  mimeType = "image/jpeg",
): Promise<GroupImageUploadResult | null> {
  const session = await getValidSession();
  if (!session) return null;

  const form = new FormData();
  const ext = mimeType.split("/")[1] ?? "jpg";
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("image", blob, `group-image.${ext}`);
  } else {
    appendImageToForm(form, "image", uri, mimeType, "group-image");
  }

  const json = await postMultipart<{
    success?: boolean;
    displayUrl?: string;
    imageVersion?: number;
  }>(`${getApiBase()}/api/groups/${groupId}/image`, form, session);

  if (!json.success || !json.displayUrl) return null;

  const imageVersion =
    typeof json.imageVersion === "number" ? json.imageVersion : 0;

  return {
    displayUrl: json.displayUrl,
    imageVersion,
    imageUri: buildApiImageUri(json.displayUrl, imageVersion),
  };
}
