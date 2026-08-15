import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, InteractionManager, Platform } from "react-native";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import { ENABLE_MIC_PASS, ENABLE_RACE_VOICE_CHAT, ENABLE_VOICE_SDK } from "@/config/featureFlags";
import { voiceService } from "@/services/voiceService";
import { isDummyUnlimitedRaceId } from "@/services/dummyUnlimitedRace";
import { AppAlert } from "@/components/AppAlert";
import {
  type LiveRaceAudioRoute,
  isBluetoothOutputAvailable,
  isEarpieceOutputAvailable,
  routeAfterBluetoothDisconnect,
} from "@/utils/liveRaceAudioRoute";

export type MicState =
  | "idle"                 // voice not yet joined
  | "connecting"           // joining voice channel (or reconnecting)
  | "active"               // mic on AND local audio track published — audio flowing
  | "muted"                // joined and published but muted self (local MICROPHONE mute)
  | "listening"            // connected as listener only (can hear, cannot speak)
  | "permission_denied"    // microphone permission denied
  | "restricted"           // backend says user is voice-banned
  | "unsupported_runtime"  // Expo Go or platform without native build
  | "error"                // connection or publish failed
  | "coming_soon";         // legacy — kept so existing callers compile

/** Output route preference (Speaker / Phone / Bluetooth). Mute remains mic mute. */
export type AudioRoute = LiveRaceAudioRoute;

export interface UseMicPassReturn {
  hasMicPass: boolean;
  loadingEntitlement: boolean;
  micState: MicState;
  isSpeaking: boolean;
  activeSpeakerIds: string[];
  mutedParticipantIds: string[];
  locallyMutedUserIds: string[];
  /** True when session-level Mute All (local playback) is active. */
  muteAllActive: boolean;
  audioRoute: AudioRoute;
  bluetoothAvailable: boolean;
  btDeviceName: string;
  showMicMenu: boolean;
  showPurchaseModal: boolean;
  openPurchaseModal: () => void;
  closePurchaseModal: () => void;
  closeMicMenu: () => void;
  selectSpeaker: () => void;
  selectPhone: () => void;
  selectBluetooth: () => void;
  selectMute: () => void;
  grantMicPass: () => void;
  handleMicTap: () => void;
  muteSelf: () => void;
  unmuteSelf: () => void;
  disconnectVoice: () => void;
  notifyRaceStarted: () => void;
  localMuteParticipant: (userId: string) => void;
  localUnmuteParticipant: (userId: string) => void;
  /**
   * Locally mute all remote participants' audio on this device.
   * Does not mute the current user's microphone.
   * Pass known remote user IDs so the UI updates immediately; new joiners
   * inherit mute-all via voiceService session flag.
   */
  muteAllRemoteParticipants: (remoteUserIds: string[]) => void;
  /** Restore local playback for all remotes previously silenced by Mute All / individual mute. */
  unmuteAllRemoteParticipants: () => void;
  /** Effective local mute for a remote user (respects Mute All + exceptions). */
  isRemoteLocallyMuted: (userId: string) => boolean;
}

/**
 * Module-level (not component-ref) so it survives Live Race screen remounts —
 * leaving and re-entering the same race must not re-trigger the auto
 * listen-only connect every time. Per-raceId, cleared only on app restart.
 */
const autoListenConnectedRaceIds = new Set<string>();

export function useMicPass(raceId?: string): UseMicPassReturn {
  const [hasMicPass, setHasMicPass]                = useState(false);
  const [loadingEntitlement, setLoadingEntitlement] = useState(true);
  const [micState, setMicState]                    = useState<MicState>("idle");
  const [isSpeaking, setIsSpeaking]                = useState(false);
  const [activeSpeakerIds, setActiveSpeakerIds]    = useState<string[]>([]);
  const [mutedParticipantIds, setMutedParticipantIds] = useState<string[]>([]);
  const [locallyMutedUserIds, setLocallyMutedUserIds] = useState<string[]>([]);
  const [muteAllActive, setMuteAllActive] = useState(false);
  const [unmuteExceptions, setUnmuteExceptions] = useState<string[]>([]);
  const [audioRoute, setAudioRoute]                = useState<AudioRoute>("speaker");
  const muteAllActiveRef = useRef(false);
  const unmuteExceptionsRef = useRef<string[]>([]);
  const dummyAudioOnly = isDummyUnlimitedRaceId(raceId);
  const [bluetoothAvailable, setBluetoothAvailable] = useState(false);
  const [btDeviceName, setBtDeviceName]            = useState("Bluetooth");
  const [showMicMenu, setShowMicMenu]              = useState(false);
  const [showPurchaseModal, setShowPurchaseModal]   = useState(false);

  const mountedRef              = useRef(true);
  const micStateRef             = useRef<MicState>("idle");
  const hasMicPassRef           = useRef(hasMicPass);
  const autoConnectAttemptedRef = useRef(false);
  const audioRouteRef           = useRef<AudioRoute>("speaker");

  useEffect(() => { micStateRef.current  = micState;   }, [micState]);
  // Sync mute-all refs during render so first-tap unmute never reads a stale value.
  muteAllActiveRef.current = muteAllActive;
  unmuteExceptionsRef.current = unmuteExceptions;
  useEffect(() => { hasMicPassRef.current = hasMicPass; }, [hasMicPass]);
  useEffect(() => { audioRouteRef.current = audioRoute; }, [audioRoute]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch entitlement after interactions so Live Detail first paint isn't competing.
  useEffect(() => {
    if (!ENABLE_MIC_PASS) {
      setLoadingEntitlement(false);
      return;
    }
    let cancelled = false;
    const fetchEntitlement = async () => {
      try {
        if (__DEV__) console.log("[MicPass] status fetch started");

        const session = await getValidSession();
        if (!session || cancelled) return;
        const res = await fetch(`${getApiBase()}/api/mic-pass/status`, {
          headers: { Authorization: `Bearer ${session}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { has_mic_pass?: boolean };
        if (!cancelled) {
          const owned = data?.has_mic_pass === true;
          if (__DEV__) console.log("[MicPass] has_mic_pass:", owned);
          setHasMicPass(owned);
        }
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoadingEntitlement(false);
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      void fetchEntitlement();
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, []);

  // Cleanup voice after unmount so back navigation is not blocked.
  useEffect(() => {
    return () => {
      setTimeout(() => {
        voiceService.cleanupVoice("unmount");
      }, 0);
    };
  }, []);

  // Mute mic when app goes to background; reapply output route on resume.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        if (micStateRef.current === "active") {
          voiceService.muteMic().catch(() => {});
          setMicState("muted");
          setIsSpeaking(false);
          setActiveSpeakerIds([]);
          if (__DEV__) console.log("[Voice] backgrounded — mic muted");
        }
      } else if (nextState === "active") {
        const connected =
          micStateRef.current === "active" ||
          micStateRef.current === "muted" ||
          micStateRef.current === "listening";
        if (connected) {
          voiceService.setAudioRoute(audioRouteRef.current).catch(() => {});
        }
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for Bluetooth availability while the voice session is active.
  useEffect(() => {
    if (micState !== "active" && micState !== "muted" && micState !== "listening") {
      setBluetoothAvailable(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const outputs = await voiceService.getAudioOutputs();
      if (!cancelled && mountedRef.current) {
        // iOS getAudioOutputs only returns default/force_speaker — show BT control
        // so users can request OS default routing (AirPods when connected).
        const hasBt =
          Platform.OS === "ios"
            ? true
            : isBluetoothOutputAvailable(outputs);
        const wasAvailable = bluetoothAvailable;
        setBluetoothAvailable(hasBt);
        if (hasBt) {
          const btName = outputs.find((o) => o.toLowerCase().includes("bluetooth"));
          setBtDeviceName(btName ?? "Bluetooth");
        } else if (wasAvailable && Platform.OS === "android") {
          const next = routeAfterBluetoothDisconnect(audioRouteRef.current, false);
          if (next !== audioRouteRef.current) {
            setAudioRoute(next);
            voiceService.setAudioRoute(next).catch(() => {});
            AppAlert.alert(
              "Bluetooth disconnected",
              "Audio switched to Speaker.",
            );
          }
        }
      }
    };
    void poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micState]);

  const openPurchaseModal  = useCallback(() => setShowPurchaseModal(true),  []);
  const closePurchaseModal = useCallback(() => setShowPurchaseModal(false), []);
  const closeMicMenu       = useCallback(() => setShowMicMenu(false), []);

  const grantMicPass = useCallback(() => {
    setHasMicPass(true);
    setShowPurchaseModal(false);
    setMicState("idle");
  }, []);

  /**
   * notifyRaceStarted — call when race becomes in_progress.
   *
   * Auto-connects ALL participants as listeners (listenOnly: true) so they
   * hear voice without requiring a mic tap. Non-Mic-Pass users stay as
   * listeners indefinitely. Mic Pass holders can tap the mic icon to upgrade
   * to speaker (calls startPublishing on the already-connected room).
   *
   * Idempotent — does nothing if already connecting/connected/listening.
   */
  const notifyRaceStarted = useCallback(() => {
    if (!raceId) return;
    if (!ENABLE_RACE_VOICE_CHAT || !ENABLE_VOICE_SDK) return;
    if (!voiceService.isVoiceSupportedRuntime()) return;
    if (autoConnectAttemptedRef.current) return;
    // Only auto-join as a listener once per race — re-entering the Live Race
    // screen (remount) must not silently reconnect the mic/voice session again.
    // The mic icon (handleMicTap) still works normally for the user to join
    // manually at any time.
    if (autoListenConnectedRaceIds.has(raceId)) return;
    if (micStateRef.current !== "idle") return;

    autoConnectAttemptedRef.current = true;
    setMicState("connecting");

    void voiceService.connectToRaceVoice(
      raceId,
      {
        onState: (state) => {
          if (!mountedRef.current) return;
          if (state === "disconnected") {
            setMicState("idle");
            setIsSpeaking(false);
            setActiveSpeakerIds([]);
            setMutedParticipantIds([]);
            setAudioRoute("speaker");
            setBluetoothAvailable(false);
            autoConnectAttemptedRef.current = false;
          } else if (state === "reconnecting") {
            setMicState("connecting");
          } else if (state === "reconnected") {
            const cur = micStateRef.current;
            if (cur !== "listening") setMicState("active");
          }
        },
        onSpeaking: (speaking) => {
          if (!mountedRef.current) return;
          setIsSpeaking(speaking);
        },
        onActiveSpeakers: (userIds) => {
          if (!mountedRef.current) return;
          setActiveSpeakerIds(userIds);
        },
        onMuteChanged: (userId, muted) => {
          if (!mountedRef.current) return;
          setMutedParticipantIds((prev) =>
            muted
              ? prev.includes(userId) ? prev : [...prev, userId]
              : prev.filter((id) => id !== userId),
          );
        },
      },
      { listenOnly: true },
    ).then((ok) => {
      if (!mountedRef.current) return;
      if (ok) {
        autoListenConnectedRaceIds.add(raceId);
        setMicState("listening");
        setAudioRoute("speaker");
        if (__DEV__) console.log("[Voice] auto-connected as listener");
      } else {
        setMicState("idle");
        autoConnectAttemptedRef.current = false;
        if (__DEV__) console.log("[Voice] auto-connect as listener failed (non-fatal)");
      }
    }).catch(() => {
      if (!mountedRef.current) return;
      setMicState("idle");
      autoConnectAttemptedRef.current = false;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  const handleMicTap = useCallback(() => {
    const current = micStateRef.current;
    if (__DEV__) console.log("[VoiceMenu] mic tapped:", raceId ?? "no-race", "state:", current);

    // ── Listening: tap to upgrade to speaker (Mic Pass) or to purchase ────────
    if (current === "listening") {
      if (!hasMicPass) {
        setShowPurchaseModal(true);
        return;
      }
      // Mic Pass holder already in the room — just start publishing.
      setMicState("connecting");
      void (async () => {
        try {
          const permStatus = await voiceService.requestMicPermission();
          if (!mountedRef.current) return;
          if (permStatus !== "granted") {
            setMicState("listening");
            return;
          }
          const ok = await voiceService.startPublishing();
          if (!mountedRef.current) return;
          if (ok) {
            setMicState("active");
            setAudioRoute("speaker");
            if (__DEV__) console.log("[Voice] listener upgraded to speaker");
          } else {
            setMicState("listening");
          }
        } catch {
          if (mountedRef.current) setMicState("listening");
        }
      })();
      return;
    }

    if (!hasMicPass) {
      setShowPurchaseModal(true);
      return;
    }

    if (!ENABLE_RACE_VOICE_CHAT || !ENABLE_VOICE_SDK) {
      setMicState("coming_soon");
      return;
    }

    if (current === "active" || current === "muted") {
      if (__DEV__) console.log("[VoiceMenu] opened:", current);
      setShowMicMenu(true);
      return;
    }

    if (current === "unsupported_runtime") {
      setMicState("idle");
      return;
    }

    if (current !== "idle" && current !== "error") return;

    if (!voiceService.isVoiceSupportedRuntime()) {
      setMicState("unsupported_runtime");
      return;
    }

    setMicState("connecting");

    void (async () => {
      try {
        const permStatus = await voiceService.requestMicPermission();
        if (!mountedRef.current) return;
        if (permStatus !== "granted") {
          setMicState("permission_denied");
          return;
        }

        if (!raceId) {
          setMicState("error");
          return;
        }

        const ok = await voiceService.connectToRaceVoice(raceId, {
          onState: (state) => {
            if (!mountedRef.current) return;
            if (state === "disconnected") {
              setMicState("idle");
              setIsSpeaking(false);
              setActiveSpeakerIds([]);
              setMutedParticipantIds([]);
              setAudioRoute("speaker");
              setBluetoothAvailable(false);
            } else if (state === "reconnecting") {
              setMicState("connecting");
            } else if (state === "reconnected") {
              setMicState("active");
            }
          },
          onSpeaking: (speaking) => {
            if (!mountedRef.current) return;
            if (__DEV__) {
              if (speaking) console.log("[VoiceActivity] local speaking started:", "local user");
              else          console.log("[VoiceActivity] local speaking stopped:", "local user");
            }
            setIsSpeaking(speaking);
          },
          onActiveSpeakers: (userIds) => {
            if (!mountedRef.current) return;
            setActiveSpeakerIds(userIds);
          },
          onMuteChanged: (userId, muted) => {
            if (!mountedRef.current) return;
            if (__DEV__) {
              if (muted) console.log("[VoiceActivity] remote speaking stopped:", userId, "(muted)");
              else       console.log("[VoiceActivity] remote speaking started:", userId, "(unmuted)");
            }
            setMutedParticipantIds((prev) =>
              muted
                ? prev.includes(userId) ? prev : [...prev, userId]
                : prev.filter((id) => id !== userId),
            );
          },
        });

        if (!mountedRef.current) return;
        if (!ok) {
          setMicState("error");
        } else {
          setMicState("active");
          setAudioRoute("speaker");
        }
      } catch {
        if (mountedRef.current) setMicState("error");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMicPass, raceId]);

  // ── Route selectors — apply natively first; update UI only on success ───────
  const applyRoute = useCallback(async (requested: AudioRoute) => {
    if (__DEV__) console.log("[VoiceMenu] option selected:", requested);

    if (requested === "bluetooth" && Platform.OS === "android" && !bluetoothAvailable) {
      AppAlert.alert("Bluetooth", "No Bluetooth audio device is connected.");
      return;
    }

    if (requested === "phone") {
      const outputs = await voiceService.getAudioOutputs();
      if (
        Platform.OS === "android" &&
        !isEarpieceOutputAvailable(outputs, Platform.OS)
      ) {
        AppAlert.alert("Phone audio", "Phone audio is not available on this device.");
        return;
      }
    }

    const result = await voiceService.setAudioRoute(requested);
    if (!mountedRef.current) return;
    if (result.ok) {
      setAudioRoute(result.route);
    } else {
      AppAlert.alert(
        "Audio",
        result.message ?? "We couldn’t switch the audio output. Please try again.",
      );
    }
  }, [bluetoothAvailable]);

  const selectSpeaker = useCallback(() => {
    void applyRoute("speaker");
  }, [applyRoute]);

  const selectPhone = useCallback(() => {
    void applyRoute("phone");
  }, [applyRoute]);

  const selectBluetooth = useCallback(() => {
    void applyRoute("bluetooth");
  }, [applyRoute]);

  /**
   * Mute in this menu toggles the LOCAL MICROPHONE (existing product behavior).
   * Icons are mic / mic-off. It does not silence remote race audio output and
   * does not leave the LiveKit room.
   */
  const selectMute = useCallback(() => {
    const current = micStateRef.current;
    if (__DEV__) console.log("[VoiceMenu] option selected: mute, current state:", current);
    setShowMicMenu(false);
    if (current === "active") {
      setMicState("muted");
      setIsSpeaking(false);
      voiceService.muteMic().catch(() => {});
      if (__DEV__) console.log("[VoiceMute] muted: local user");
    } else if (current === "muted") {
      setMicState("active");
      voiceService.unmuteMic().catch(() => {});
      if (__DEV__) console.log("[VoiceMute] unmuted: local user");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const muteSelf = useCallback(() => {
    if (micStateRef.current === "active") {
      setMicState("muted");
      setIsSpeaking(false);
      voiceService.muteMic().catch(() => {});
    }
  }, []);

  const unmuteSelf = useCallback(() => {
    if (micStateRef.current === "muted") {
      setMicState("active");
      voiceService.unmuteMic().catch(() => {});
    }
  }, []);

  const disconnectVoice = useCallback(() => {
    if (!dummyAudioOnly) {
      voiceService.disconnectVoice("explicit").catch(() => {});
    }
    setMicState("idle");
    setIsSpeaking(false);
    setActiveSpeakerIds([]);
    setMutedParticipantIds([]);
    setLocallyMutedUserIds([]);
    setMuteAllActive(false);
    setUnmuteExceptions([]);
    setAudioRoute("speaker");
    setBluetoothAvailable(false);
    setShowMicMenu(false);
    autoConnectAttemptedRef.current = false;
  }, [dummyAudioOnly]);

  // Read state (not effect-synced refs) so Mute All → Unmute updates on the first tap/render.
  const isRemoteLocallyMuted = useCallback((userId: string) => {
    if (muteAllActive) {
      return !unmuteExceptions.includes(userId);
    }
    return locallyMutedUserIds.includes(userId);
  }, [muteAllActive, unmuteExceptions, locallyMutedUserIds]);

  /**
   * Individual local mute. Clears any Mute-All exception for this user.
   * Does not change the current user's microphone.
   */
  const localMuteParticipant = useCallback((userId: string) => {
    setUnmuteExceptions((prev) => prev.filter((id) => id !== userId));
    setLocallyMutedUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    if (!dummyAudioOnly) {
      voiceService.setParticipantLocalVolume(userId, 0).catch(() => {});
    }
  }, [dummyAudioOnly]);

  /**
   * Individual local unmute.
   * When Mute All is active, creates an explicit exception for this user only
   * (Mute All remains on for everyone else). Otherwise removes from mute list.
   */
  const localUnmuteParticipant = useCallback((userId: string) => {
    if (muteAllActiveRef.current) {
      setUnmuteExceptions((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    }
    setLocallyMutedUserIds((prev) => prev.filter((id) => id !== userId));
    if (!dummyAudioOnly) {
      voiceService.setParticipantLocalVolume(userId, 1).catch(() => {});
    }
  }, [dummyAudioOnly]);

  const muteAllRemoteParticipants = useCallback((remoteUserIds: string[]) => {
    setMuteAllActive(true);
    setUnmuteExceptions([]);
    const unique = [...new Set(remoteUserIds.filter(Boolean))];
    setLocallyMutedUserIds(unique);
    if (!dummyAudioOnly) {
      voiceService.setMuteAllRemoteLocal(true).catch(() => {});
    }
  }, [dummyAudioOnly]);

  const unmuteAllRemoteParticipants = useCallback(() => {
    setMuteAllActive(false);
    setUnmuteExceptions([]);
    setLocallyMutedUserIds([]);
    if (!dummyAudioOnly) {
      voiceService.setMuteAllRemoteLocal(false).catch(() => {});
    }
  }, [dummyAudioOnly]);

  return {
    hasMicPass,
    loadingEntitlement,
    activeSpeakerIds,
    mutedParticipantIds,
    locallyMutedUserIds,
    muteAllActive,
    audioRoute,
    bluetoothAvailable,
    btDeviceName,
    showMicMenu,
    micState,
    isSpeaking,
    showPurchaseModal,
    openPurchaseModal,
    closePurchaseModal,
    closeMicMenu,
    selectSpeaker,
    selectPhone,
    selectBluetooth,
    selectMute,
    grantMicPass,
    handleMicTap,
    muteSelf,
    unmuteSelf,
    disconnectVoice,
    notifyRaceStarted,
    localMuteParticipant,
    localUnmuteParticipant,
    muteAllRemoteParticipants,
    unmuteAllRemoteParticipants,
    isRemoteLocallyMuted,
  };
}
