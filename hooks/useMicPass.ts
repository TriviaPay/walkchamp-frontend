import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import { ENABLE_MIC_PASS, ENABLE_RACE_VOICE_CHAT, ENABLE_VOICE_SDK } from "@/config/featureFlags";
import { voiceService } from "@/services/voiceService";

export type MicState =
  | "idle"                 // voice not yet joined
  | "connecting"           // joining voice channel (or reconnecting)
  | "active"               // mic on AND local audio track published — audio flowing
  | "muted"                // joined and published but muted self
  | "listening"            // connected as listener only (can hear, cannot speak)
  | "permission_denied"    // microphone permission denied
  | "restricted"           // backend says user is voice-banned
  | "unsupported_runtime"  // Expo Go or platform without native build
  | "error"                // connection or publish failed
  | "coming_soon";         // legacy — kept so existing callers compile

export type AudioRoute = "phone" | "speaker" | "bluetooth";

export interface UseMicPassReturn {
  hasMicPass: boolean;
  loadingEntitlement: boolean;
  micState: MicState;
  isSpeaking: boolean;
  activeSpeakerIds: string[];
  mutedParticipantIds: string[];
  locallyMutedUserIds: string[];
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
}

export function useMicPass(raceId?: string): UseMicPassReturn {
  const [hasMicPass, setHasMicPass]                = useState(false);
  const [loadingEntitlement, setLoadingEntitlement] = useState(true);
  const [micState, setMicState]                    = useState<MicState>("idle");
  const [isSpeaking, setIsSpeaking]                = useState(false);
  const [activeSpeakerIds, setActiveSpeakerIds]    = useState<string[]>([]);
  const [mutedParticipantIds, setMutedParticipantIds] = useState<string[]>([]);
  const [locallyMutedUserIds, setLocallyMutedUserIds] = useState<string[]>([]);
  const [audioRoute, setAudioRoute]                = useState<AudioRoute>("speaker");
  const [bluetoothAvailable, setBluetoothAvailable] = useState(false);
  const [btDeviceName, setBtDeviceName]            = useState("Bluetooth");
  const [showMicMenu, setShowMicMenu]              = useState(false);
  const [showPurchaseModal, setShowPurchaseModal]   = useState(false);

  const mountedRef              = useRef(true);
  const micStateRef             = useRef<MicState>("idle");
  const hasMicPassRef           = useRef(hasMicPass);
  const autoConnectAttemptedRef = useRef(false);

  useEffect(() => { micStateRef.current  = micState;   }, [micState]);
  useEffect(() => { hasMicPassRef.current = hasMicPass; }, [hasMicPass]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch entitlement from backend on mount.
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
    void fetchEntitlement();
    return () => { cancelled = true; };
  }, []);

  // Cleanup voice after unmount so back navigation is not blocked.
  useEffect(() => {
    return () => {
      setTimeout(() => {
        voiceService.cleanupVoice("unmount");
      }, 0);
    };
  }, []);

  // Mute mic when app goes to background.
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
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for Bluetooth availability while the voice session is active.
  useEffect(() => {
    if (micState !== "active" && micState !== "muted") {
      setBluetoothAvailable(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const outputs = await voiceService.getAudioOutputs();
      if (!cancelled && mountedRef.current) {
        const hasBt = outputs.some((o) => o.toLowerCase().includes("bluetooth"));
        setBluetoothAvailable(hasBt);
        if (hasBt) {
          const btName = outputs.find((o) => o.toLowerCase().includes("bluetooth"));
          setBtDeviceName(btName ?? "Bluetooth");
          if (__DEV__) console.log("[VoiceRoute] bluetooth connected:", btName ?? "Bluetooth");
        } else {
          if (__DEV__ && bluetoothAvailable) console.log("[VoiceRoute] bluetooth disconnected");
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

  // ── Route selectors — intentionally keep the menu open on selection ─────────
  // Removing setShowMicMenu(false) here means the user sees the active-route
  // highlight update instantly. The backdrop Pressable closes the menu when
  // they tap outside, or selectMute closes it on mute toggle.
  const selectSpeaker = useCallback(() => {
    if (__DEV__) console.log("[VoiceMenu] option selected: speaker");
    setAudioRoute("speaker");
    voiceService.setAudioRoute("speaker").catch(() => {});
  }, []);

  const selectPhone = useCallback(() => {
    if (__DEV__) console.log("[VoiceMenu] option selected: phone");
    setAudioRoute("phone");
    voiceService.setAudioRoute("phone").catch(() => {});
  }, []);

  const selectBluetooth = useCallback(() => {
    if (__DEV__) console.log("[VoiceMenu] option selected: bluetooth");
    setAudioRoute("bluetooth");
    voiceService.setAudioRoute("bluetooth").catch(() => {});
  }, []);

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
    voiceService.disconnectVoice("explicit").catch(() => {});
    setMicState("idle");
    setIsSpeaking(false);
    setActiveSpeakerIds([]);
    setMutedParticipantIds([]);
    setLocallyMutedUserIds([]);
    setAudioRoute("speaker");
    setBluetoothAvailable(false);
    setShowMicMenu(false);
    autoConnectAttemptedRef.current = false;
  }, []);

  const localMuteParticipant = useCallback((userId: string) => {
    setLocallyMutedUserIds((prev) => prev.includes(userId) ? prev : [...prev, userId]);
    voiceService.setParticipantLocalVolume(userId, 0).catch(() => {});
  }, []);

  const localUnmuteParticipant = useCallback((userId: string) => {
    setLocallyMutedUserIds((prev) => prev.filter((id) => id !== userId));
    voiceService.setParticipantLocalVolume(userId, 1).catch(() => {});
  }, []);

  return {
    hasMicPass,
    loadingEntitlement,
    activeSpeakerIds,
    mutedParticipantIds,
    locallyMutedUserIds,
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
  };
}
