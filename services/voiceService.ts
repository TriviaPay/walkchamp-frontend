/**
 * voiceService — LiveKit voice chat for live races.
 *
 * Safe in Expo Go: detects storeClient at runtime and returns no-ops.
 * Real audio only runs in dev builds, APK/AAB, or TestFlight/App Store.
 *
 * Audio pipeline (in order):
 *   1. requestMicPermission()   — Android runtime RECORD_AUDIO dialog
 *   2. connectToRaceVoice()     — fetches backend token,
 *                                 a) configureAudioSession(useSpeaker)  ← sets routing preferences
 *                                 b) startVoiceAudioSession()           ← activates the session
 *                                 c) setDefaultRemoteAudioTrackVolume(1.0) ← ensures full volume
 *                                 d) connects Room + registers remote track handlers
 *                                 e) publishMicrophone()
 *   3. publishMicrophone()      — setMicrophoneEnabled(true), verifies publication
 *   4. muteMic() / unmuteMic()  — setMicrophoneEnabled(false/true)
 *   5. setSpeakerMode(bool)     — reconfigures route mid-session (earpiece ↔ speaker)
 *   6. disconnectVoice()        — room.disconnect() → stopVoiceAudioSession() → releases resources
 *
 * AUDIO ROUTING:
 *   Default = earpiece/receiver (phone-call style).
 *   Speaker = explicit user selection via mic menu.
 *   Wired/BT = detected automatically by OS; routes are applied over user preference.
 *
 * CRITICAL NOTES:
 *   - Use AudioSession.configureAudio() — NOT AudioSession.configure() (doesn't exist).
 *   - Call AudioSession.startAudioSession() BEFORE connecting — without it the native
 *     audio session is never activated (iOS stays silent, Android loses audio focus).
 *   - Call AudioSession.stopAudioSession() on disconnect — without it the session stays
 *     active and breaks audio on subsequent joins.
 *   - Do NOT use createLocalAudioTrack() + publishTrack() directly — that path bypasses
 *     native session setup and produces silent tracks.
 *   - audioStreamType must be "voiceCall", not "music". Using "music" sends audio to
 *     STREAM_MUSIC focus which conflicts with inCommunication mode on Android.
 */
import Constants from "expo-constants";
import { PermissionsAndroid, Platform } from "react-native";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import { timeoutSignal, CHAT_TIMEOUT } from "@/utils/authFetch";

// ── Runtime detection ─────────────────────────────────────────────────────────
// "storeClient" == Expo Go. Native LiveKit/WebRTC modules are absent there.
const isExpoGo: boolean = Constants.executionEnvironment === "storeClient";

// ── Lazy SDK loader ───────────────────────────────────────────────────────────
type RnModule     = typeof import("@livekit/react-native");
type ClientModule = typeof import("livekit-client");

let rnModule:     RnModule     | null = null;
let clientModule: ClientModule | null = null;
let sdkInitialized = false;

function loadSDK(): ClientModule | null {
  if (isExpoGo)       return null;
  if (sdkInitialized) return clientModule;
  sdkInitialized = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    rnModule = require("@livekit/react-native") as RnModule;
    rnModule.registerGlobals();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    clientModule = require("livekit-client") as ClientModule;
    if (__DEV__) {
      if (__DEV__) console.log("[VoiceSDK] provider: livekit");
      if (__DEV__) console.log("[VoiceSDK] runtime supported: true");
    }
    return clientModule;
  } catch (e) {
    if (__DEV__) console.log("[VoiceSDK] runtime supported: false", e);
    return null;
  }
}

// ── Audio session helpers ─────────────────────────────────────────────────────

/**
 * Configure AudioSession routing preferences.
 *
 * route = "phone"     → earpiece/receiver (default phone-call style)
 * route = "speaker"   → loudspeaker
 * route = "bluetooth" → Bluetooth SCO/A2DP device (Android explicit; iOS auto)
 *
 * Wired headset always takes priority on Android regardless of route choice.
 * audioStreamType must be "voiceCall" to keep echo-cancellation and audio focus
 * working correctly in inCommunication mode.
 */
async function configureAudioSession(route: "phone" | "speaker" | "bluetooth"): Promise<void> {
  if (!rnModule) return;
  if (__DEV__) console.log("[VoiceRoute] requested route:", route);
  try {
    await rnModule.AudioSession.configureAudio({
      android: {
        preferredOutputList:
          route === "bluetooth"
            ? ["bluetooth", "headset", "speaker", "earpiece"]
            : route === "speaker"
            ? ["headset", "bluetooth", "speaker", "earpiece"]
            : ["headset", "bluetooth", "earpiece", "speaker"],
        audioTypeOptions: {
          manageAudioFocus:           true,
          audioMode:                  "inCommunication",
          audioFocusMode:             "gain",
          audioStreamType:            "voiceCall",
          audioAttributesUsageType:   "voiceCommunication",
          audioAttributesContentType: "speech",
          forceHandleAudioRouting:    true,
        },
      },
      ios: {
        // iOS auto-routes to Bluetooth when connected; defaultOutput controls phone vs speaker.
        defaultOutput: route === "speaker" ? "speaker" : "earpiece",
      },
    });
    if (__DEV__) console.log("[VoiceRoute] applied route:", route);
  } catch (e) {
    if (__DEV__) console.log("[VoiceRoute] configureAudio failed (non-fatal):", e);
  }
}

/**
 * Start the native audio session and set remote track volume.
 *
 * Must be called AFTER configureAudioSession() and BEFORE
 * room.connect(). Without this call:
 *   iOS  — AVAudioSession is never activated → no audio output at all.
 *   Android — audio focus is never requested → system may silence audio.
 *
 * Also sets the default remote track volume to 1.0 (max) to guard against
 * silent remote audio caused by the default being 0 on some SDK versions.
 */
async function startVoiceAudioSession(): Promise<void> {
  if (!rnModule) return;
  try {
    await rnModule.AudioSession.startAudioSession();
    if (__DEV__) {
      if (__DEV__) console.log("[VoiceRoute] iOS audio session configured: true");
      if (__DEV__) console.log("[VoiceRoute] Android audio manager configured: true");
    }
  } catch (e) {
    if (__DEV__) console.log("[VoiceRoute] startAudioSession failed:", e);
  }
  try {
    await rnModule.AudioSession.setDefaultRemoteAudioTrackVolume(1.0);
    if (__DEV__) console.log("[VoiceRoute] remote audio volume: 1.0");
  } catch (e) {
    if (__DEV__) console.log("[VoiceRoute] setDefaultRemoteAudioTrackVolume failed:", e);
  }
}

/**
 * Stop the native audio session on disconnect.
 *
 * Without this call, the session stays active after the race ends.
 * When the user joins another race, the old active session conflicts with
 * the new one and audio may be silent or routed incorrectly.
 */
async function stopVoiceAudioSession(): Promise<void> {
  if (!rnModule) return;
  try {
    await rnModule.AudioSession.stopAudioSession();
    if (__DEV__) console.log("[VoiceRoute] audio session stopped");
  } catch {}
}

/**
 * Log the current platform and available audio outputs for debugging.
 * Safe to call at any time; never throws.
 */
async function logAudioRoute(): Promise<void> {
  if (!rnModule || !__DEV__) return;
  try {
    if (__DEV__) console.log("[VoiceRoute] platform:", Platform.OS);
    const outputs = await rnModule.AudioSession.getAudioOutputs();
    if (__DEV__) console.log("[VoiceRoute] current route:", outputs.join(", "));
    if (Platform.OS === "android") {
      const hasHeadset   = outputs.includes("headset");
      const hasBluetooth = outputs.includes("bluetooth");
      if (__DEV__) console.log("[VoiceRoute] wired connected:", hasHeadset);
      if (__DEV__) console.log("[VoiceRoute] bluetooth connected:", hasBluetooth);
      if (__DEV__) console.log("[VoiceRoute] speaker selected:", !hasHeadset && !hasBluetooth && currentSpeakerMode);
      if (__DEV__) console.log("[VoiceRoute] earpiece selected:", !hasHeadset && !hasBluetooth && !currentSpeakerMode);
    } else {
      if (__DEV__) console.log("[VoiceRoute] iOS routes via AVAudioSession (defaultOutput:", currentSpeakerMode ? "speaker" : "earpiece", ")");
    }
  } catch (e) {
    if (__DEV__) console.log("[VoiceRoute] getAudioOutputs failed:", e);
  }
}

// ── Module state ──────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeRoom: any = null;
let currentRoute: "phone" | "speaker" | "bluetooth" = "speaker";
/** @deprecated – kept for logAudioRoute compat */
let currentSpeakerMode = true;
/** Whether the current session token allows publishing audio (Mic Pass + participant). */
let lastCanPublish = false;
let onSpeakingCb:        ((speaking: boolean)                    => void) | null = null;
let onStateCb:           ((state: string)                        => void) | null = null;
let onActiveSpeakersCb:  ((userIds: string[])                    => void) | null = null;
let onMuteChangedCb:     ((userId: string, muted: boolean)       => void) | null = null;
/** Client-side per-user mute — only affects this device's playback. */
const locallyMutedIds = new Set<string>();

function applyLocalVolumeToTrack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  track: any,
  userId: string,
): void {
  if (track?.kind !== "audio") return;
  const volume = locallyMutedIds.has(userId) ? 0 : 1;
  if (typeof track.setVolume === "function") {
    (track as { setVolume: (v: number) => void }).setVolume(volume);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const voiceService = {
  /** Returns false when running in Expo Go or when SDK init fails. */
  isVoiceSupportedRuntime(): boolean {
    if (isExpoGo) {
      if (__DEV__) console.log("[VoiceSDK] runtime supported: false (Expo Go)");
      return false;
    }
    return loadSDK() !== null;
  },

  /**
   * Request RECORD_AUDIO on Android.
   * On iOS, LiveKit requests NSMicrophoneUsageDescription internally when
   * setMicrophoneEnabled(true) is called.
   */
  async requestMicPermission(): Promise<"granted" | "denied" | "blocked"> {
    if (__DEV__) console.log("[Voice] requesting permission");
    if (Platform.OS !== "android") {
      if (__DEV__) console.log("[Voice] permission status: granted (iOS — handled by LiveKit)");
      return "granted";
    }
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Microphone Permission",
          message:
            "Microphone permission is required to use Mic Pass voice chat during live races.",
          buttonPositive: "Allow",
          buttonNegative: "Deny",
        },
      );
      const status =
        result === PermissionsAndroid.RESULTS.GRANTED
          ? "granted"
          : result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ? "blocked"
          : "denied";
      if (__DEV__) console.log("[Voice] permission status:", status);
      return status;
    } catch {
      if (__DEV__) console.log("[Voice] permission denied (exception)");
      return "denied";
    }
  },

  /** Fetch a short-lived LiveKit token from the backend. */
  async getVoiceToken(raceId: string): Promise<{
    token: string;
    url: string;
    roomName: string;
    canPublish: boolean;
  } | null> {
    if (__DEV__) console.log("[Voice] connect started:", raceId);
    try {
      const session = await getValidSession();
      if (!session) return null;
      const res = await fetch(`${getApiBase()}/api/races/${raceId}/voice-token`, {
        method: "POST",
        signal: timeoutSignal(CHAT_TIMEOUT),
        headers: {
          Authorization: `Bearer ${session}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { code?: string };
        if (__DEV__) console.log("[VoiceError] connection:", body?.code ?? res.status);
        return null;
      }
      const data = await res.json() as {
        success: boolean;
        token?: string;
        url?: string;
        room_name?: string;
        can_publish_audio?: boolean;
      };
      if (!data.success || !data.token) return null;
      if (__DEV__) {
        if (__DEV__) console.log("[Voice] token received — room:", data.room_name);
        if (__DEV__) console.log("[Voice] canPublishAudio:", data.can_publish_audio ?? false);
      }
      return {
        token:      data.token,
        url:        data.url!,
        roomName:   data.room_name!,
        canPublish: data.can_publish_audio === true,
      };
    } catch (e) {
      const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (__DEV__) console.log("[VoiceError] connection:", isTimeout ? "timeout" : e);
      return null;
    }
  },

  /**
   * Connect to the LiveKit room for a race and publish the local microphone.
   *
   * Returns true only after:
   *   1. AudioSession configured (earpiece as default route)
   *   2. AudioSession started (session activated, remote volume set to 1.0)
   *   3. Room is connected
   *   4. Local mic track is published (if canPublish)
   *   5. Publication is verified to exist
   */
  async connectToRaceVoice(
    raceId: string,
    callbacks: {
      onState:          (state: string)                    => void;
      onSpeaking:       (speaking: boolean)                => void;
      onActiveSpeakers: (userIds: string[])                => void;
      onMuteChanged?:   (userId: string, muted: boolean)  => void;
    },
    options?: { listenOnly?: boolean },
  ): Promise<boolean> {
    const sdk = loadSDK();
    if (!sdk) {
      if (__DEV__) console.log("[VoiceError] connection: LiveKit SDK unavailable (Expo Go or init failed)");
      return false;
    }

    if (__DEV__) console.log("[VoiceMenu] mic tapped:", raceId);

    const tokenData = await voiceService.getVoiceToken(raceId);
    if (!tokenData) return false;

    lastCanPublish = tokenData.canPublish;

    // Disconnect any existing session first — prevents duplicate audio streams
    // and stale sessions blocking a fresh join.
    await voiceService.disconnectVoice("reconnect");

    // Default to speaker mode — loudspeaker is the expected output for a gaming app.
    currentRoute       = "speaker";
    currentSpeakerMode = true;

    onStateCb           = callbacks.onState;
    onSpeakingCb        = callbacks.onSpeaking;
    onActiveSpeakersCb  = callbacks.onActiveSpeakers;
    onMuteChangedCb     = callbacks.onMuteChanged ?? null;

    try {
      // ── Step 1: Configure audio routing preferences (speaker default) ─────────
      await configureAudioSession("speaker");

      // ── Step 2: Activate the native audio session ────────────────────────────
      // Without startAudioSession(), iOS audio is silent (AVAudioSession is never
      // set active) and Android never requests audio focus.
      await startVoiceAudioSession();

      // ── Step 3 (DEV only): Log current route for diagnostics ─────────────────
      await logAudioRoute();

      if (__DEV__) {
        if (__DEV__) console.log("[Voice] connecting room:", tokenData.roomName);
        if (__DEV__) console.log("[Voice] canPublishAudio:", tokenData.canPublish);
      }

      // ── Step 4: Create Room ──────────────────────────────────────────────────
      activeRoom = new sdk.Room({
        audioCaptureDefaults: {
          echoCancellation:  true,
          noiseSuppression:  true,
          autoGainControl:   true,
        },
        adaptiveStream: true,
        dynacast:       true,
      });

      // ── Connection state ─────────────────────────────────────────────────────
      activeRoom.on(sdk.RoomEvent.ConnectionStateChanged, (state: string) => {
        if (__DEV__) console.log("[Voice] room connected:", state);
        onStateCb?.(state.toLowerCase());
      });

      activeRoom.on(sdk.RoomEvent.Reconnecting, () => {
        if (__DEV__) console.log("[Voice] reconnecting...");
        onStateCb?.("reconnecting");
      });

      activeRoom.on(sdk.RoomEvent.Reconnected, async () => {
        if (__DEV__) console.log("[Voice] reconnected — reapplying audio config");
        await configureAudioSession(currentRoute);
        onStateCb?.("reconnected");
      });

      activeRoom.on(sdk.RoomEvent.Disconnected, () => {
        if (__DEV__) console.log("[Voice] disconnect: room disconnected");
        onStateCb?.("disconnected");
        onSpeakingCb?.(false);
      });

      // ── Remote participant events ─────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeRoom.on(sdk.RoomEvent.ParticipantConnected, (participant: any) => {
        if (__DEV__) console.log("[Voice] remote participant joined:", participant.identity);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeRoom.on(sdk.RoomEvent.ParticipantDisconnected, (participant: any) => {
        if (__DEV__) console.log("[Voice] remote participant disconnected:", participant.identity);
        // When a participant leaves, treat them as unmuted to clean up UI state.
        onMuteChangedCb?.(participant.identity as string, false);
      });

      // @livekit/react-native routes audio to device output automatically —
      // no manual attach() call is needed (unlike the web SDK).
      activeRoom.on(
        sdk.RoomEvent.TrackSubscribed,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (track: any, _publication: any, participant: any) => {
          const identity = participant.identity as string;
          applyLocalVolumeToTrack(track, identity);
          if (__DEV__) {
            if (__DEV__) console.log("[Voice] track subscribed — kind:", track.kind, "participant:", identity);
            if (track.kind === "audio") {
              if (__DEV__) console.log("[Voice] remote audio track subscribed:", identity);
              if (__DEV__) console.log("[Voice] remote audio playing:", identity);
            }
          }
        },
      );

      activeRoom.on(
        sdk.RoomEvent.TrackUnsubscribed,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (track: any, _publication: any, participant: any) => {
          if (__DEV__ && track.kind === "audio") {
            if (__DEV__) console.log("[Voice] remote audio track unsubscribed:", participant.identity);
          }
        },
      );

      // ── Remote mute/unmute — syncs mute indicators across all participants ────
      // LiveKit fires TrackMuted/TrackUnmuted on ALL subscriber devices when a
      // participant mutes or unmutes their track.  We expose this via onMuteChanged
      // so the UI can show muted badges without Pusher.
      activeRoom.on(
        sdk.RoomEvent.TrackMuted,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_publication: any, participant: any) => {
          if (__DEV__) console.log("[VoiceMute] muted:", participant.identity);
          onMuteChangedCb?.(participant.identity as string, true);
        },
      );

      activeRoom.on(
        sdk.RoomEvent.TrackUnmuted,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_publication: any, participant: any) => {
          if (__DEV__) console.log("[VoiceMute] unmuted:", participant.identity);
          onMuteChangedCb?.(participant.identity as string, false);
        },
      );

      // ── Active speakers — fires on ALL subscriber devices via LiveKit SFU ─────
      // The SFU observes audio levels and sends ActiveSpeakersChanged to every
      // participant, so all users see who is speaking without any Pusher events.
      activeRoom.on(sdk.RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
        const ids = (speakers as any[]).map((s: any) => s.identity as string);
        if (__DEV__) {
          if (ids.length) if (__DEV__) console.log("[VoiceActivity] remote speaking started:", ids.join(", "));
          else            if (__DEV__) console.log("[VoiceActivity] remote speaking stopped");
        }
        onActiveSpeakersCb?.(ids);
      });

      // ── Step 5: Connect to LiveKit room ──────────────────────────────────────
      await activeRoom.connect(tokenData.url, tokenData.token, {
        autoSubscribe: true,
      });

      if (__DEV__) console.log("[Voice] room connected:", tokenData.roomName);

      // ── Step 6: Publish local microphone ────────────────────────────────────
      // Skip publishing when listenOnly is true — lets all users auto-join as
      // listeners first; Mic Pass holders can upgrade later via startPublishing().
      if (tokenData.canPublish && !options?.listenOnly) {
        const published = await voiceService.publishMicrophone();
        if (!published) {
          if (__DEV__) console.log("[VoiceError] publish: mic publish failed after connect");
          await voiceService.disconnectVoice("publish_failed");
          return false;
        }
        if (__DEV__) console.log("[Voice] local audio track published: true");
      } else {
        if (__DEV__) console.log("[Voice] joined as listener only (no Mic Pass)");
      }

      return true;
    } catch (e) {
      if (__DEV__) console.log("[VoiceError] connection:", e);
      activeRoom = null;
      // Always stop the audio session if connect/publish threw — the session was
      // started in startVoiceAudioSession() and must be cleaned up even on failure.
      await stopVoiceAudioSession();
      return false;
    }
  },

  /**
   * Publish the local microphone using setMicrophoneEnabled(true), then verify
   * the publication actually exists before returning success.
   *
   * This is the ONLY correct way to publish audio in @livekit/react-native.
   * It initialises the native audio capture path after the session is active:
   *   iOS  — AVAudioSession .playAndRecord with .voiceChat/.videoChat mode
   *   Android — AudioManager STREAM_VOICE_CALL + RECORD_AUDIO capture
   *
   * Do NOT replace this with createLocalAudioTrack() + publishTrack().
   * That path bypasses native session setup and produces silent audio tracks.
   */
  async publishMicrophone(): Promise<boolean> {
    if (!activeRoom || !lastCanPublish) return false;
    try {
      if (__DEV__) console.log("[Voice] local audio track created: pending");

      await activeRoom.localParticipant.setMicrophoneEnabled(true);

      const micEnabled: boolean = activeRoom.localParticipant.isMicrophoneEnabled ?? false;
      if (!micEnabled) {
        if (__DEV__) console.log("[VoiceError] publish: isMicrophoneEnabled is false after setMicrophoneEnabled(true)");
        return false;
      }

      if (__DEV__) {
        if (__DEV__) console.log("[Voice] local audio track created: true");
        if (__DEV__) console.log("[Voice] local audio track published: true");
        if (__DEV__) console.log("[Voice] local unmuted: true");
      }

      activeRoom.localParticipant.on(
        "isSpeakingChanged",
        (speaking: boolean) => {
          if (__DEV__) {
            if (speaking) if (__DEV__) console.log("[VoiceActivity] local speaking started:", "local user");
            else          if (__DEV__) console.log("[VoiceActivity] local speaking stopped:", "local user");
          }
          onSpeakingCb?.(speaking);
        },
      );

      return true;
    } catch (e) {
      if (__DEV__) console.log("[VoiceError] publish:", e);
      return false;
    }
  },

  /** Mute local microphone without disconnecting from the room. */
  async muteMic(): Promise<void> {
    if (!activeRoom?.localParticipant) return;
    try {
      await activeRoom.localParticipant.setMicrophoneEnabled(false);
      if (__DEV__) console.log("[VoiceMute] muted: local user");
    } catch (e) {
      if (__DEV__) console.log("[VoiceError] publish:", e);
    }
  },

  /** Unmute local microphone. */
  async unmuteMic(): Promise<void> {
    if (!activeRoom?.localParticipant) return;
    try {
      await activeRoom.localParticipant.setMicrophoneEnabled(true);
      if (__DEV__) console.log("[VoiceMute] unmuted: local user");
    } catch (e) {
      if (__DEV__) console.log("[VoiceError] publish:", e);
    }
  },

  /**
   * Upgrade a listener connection to a speaker by publishing the local mic.
   * Call this when a Mic Pass holder (already connected as listener via
   * connectToRaceVoice with listenOnly:true) taps the mic icon to speak.
   * Returns true when the microphone track is successfully published.
   */
  async startPublishing(): Promise<boolean> {
    if (!activeRoom?.localParticipant) return false;
    return voiceService.publishMicrophone();
  },

  /**
   * Locally silence a remote participant (0 = muted, 1 = full volume).
   * Does not affect what other participants hear — purely client-side.
   */
  async setParticipantLocalVolume(userId: string, volume: number): Promise<void> {
    if (volume <= 0) locallyMutedIds.add(userId);
    else locallyMutedIds.delete(userId);

    if (!activeRoom) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const participant = (activeRoom.remoteParticipants as Map<string, any> | undefined)?.get(userId);
      if (!participant) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const pub of ((participant.audioTrackPublications as Map<string, any> | undefined)?.values() ?? [])) {
        if (pub.track) applyLocalVolumeToTrack(pub.track, userId);
      }
      if (__DEV__) console.log("[VoiceMute] local volume:", userId, volume);
    } catch (e) {
      if (__DEV__) console.log("[VoiceError] setParticipantLocalVolume:", e);
    }
  },

  /**
   * Switch audio output route mid-session (phone / speaker / bluetooth).
   *
   * Re-configures AVAudioSession / AudioManager preference and restarts the
   * native audio session so the OS applies the change immediately.
   * There will be a brief (~100 ms) audio interruption — acceptable for
   * a user-initiated action.
   */
  async setAudioRoute(route: "phone" | "speaker" | "bluetooth"): Promise<void> {
    if (!rnModule) return;
    currentRoute       = route;
    currentSpeakerMode = route === "speaker" || route === "bluetooth";
    if (__DEV__) console.log("[VoiceRoute] route switch started:", route);
    try {
      await configureAudioSession(route);
      await rnModule.AudioSession.stopAudioSession();
      await rnModule.AudioSession.startAudioSession();
      await rnModule.AudioSession.setDefaultRemoteAudioTrackVolume(1.0);
      if (__DEV__) {
        if (__DEV__) console.log("[VoiceRoute] route switch success:", route);
        await logAudioRoute();
      }
    } catch (e) {
      if (__DEV__) console.log("[VoiceRoute] route switch failed:", e);
    }
  },

  /** Convenience wrapper — kept for any existing callers. */
  async setSpeakerMode(enabled: boolean): Promise<void> {
    return voiceService.setAudioRoute(enabled ? "speaker" : "phone");
  },

  /** Return array of currently-active output route names (e.g. ["bluetooth", "headset"]). */
  async getAudioOutputs(): Promise<string[]> {
    if (!rnModule) return [];
    try {
      return (await rnModule.AudioSession.getAudioOutputs()) as string[];
    } catch {
      return [];
    }
  },

  /** Current route preference. */
  getCurrentRoute(): "phone" | "speaker" | "bluetooth" {
    return currentRoute;
  },

  /**
   * Disconnect from the voice room and release all audio resources.
   *
   * Calls stopAudioSession() so the native session is deactivated properly.
   * Without this, subsequent joins reuse a stale/broken session and audio
   * may be silent or routed incorrectly.
   */
  async disconnectVoice(reason = "user"): Promise<void> {
    if (!activeRoom) return;
    try {
      await activeRoom.disconnect();
    } catch {}
    if (__DEV__) console.log("[Voice] disconnect:", reason);
    activeRoom          = null;
    currentRoute        = "speaker";
    currentSpeakerMode  = true;
    locallyMutedIds.clear();
    lastCanPublish      = false;
    onStateCb           = null;
    onSpeakingCb        = null;
    onActiveSpeakersCb  = null;
    onMuteChangedCb     = null;
    await stopVoiceAudioSession();
  },

  /** Fire-and-forget disconnect for cleanup callbacks (React useEffect returns). */
  cleanupVoice(reason = "cleanup"): void {
    if (!activeRoom) return;
    const roomToDisconnect = activeRoom;
    activeRoom          = null;
    currentRoute        = "speaker";
    currentSpeakerMode  = true;
    locallyMutedIds.clear();
    lastCanPublish      = false;
    onStateCb           = null;
    onSpeakingCb        = null;
    onActiveSpeakersCb  = null;
    onMuteChangedCb     = null;
    roomToDisconnect.disconnect().catch(() => {});
    stopVoiceAudioSession().catch(() => {});
    if (__DEV__) console.log("[Voice] disconnect:", reason);
  },

  onSpeakingChanged(cb: (speaking: boolean) => void): void {
    onSpeakingCb = cb;
  },

  onConnectionStateChanged(cb: (state: string) => void): void {
    onStateCb = cb;
  },
};
