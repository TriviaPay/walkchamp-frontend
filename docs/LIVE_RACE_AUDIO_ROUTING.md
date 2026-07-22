# Live Race Audio Routing Fix

Date: 2026-07-22

## Architecture

UI (`live-detail` mic capsule) → `useMicPass` → `voiceService.setAudioRoute` →
`@livekit/react-native` `AudioSession.configureAudio` + `selectAudioOutput`.

Routes: `speaker` | `phone` | `bluetooth`  
Mute in the capsule: **local microphone mute** (existing mic/mic-off control — not changed).

## Root causes fixed

1. **Speaker**: Android `preferredOutputList` preferred headset/bluetooth *before* speaker, so Speaker never won when BT was connected. Also never called `selectAudioOutput`.
2. **Bluetooth**: Same preference bug; iOS never showed BT (getAudioOutputs has no `"bluetooth"` string).
3. **Earpiece/Phone**: Preference list put headset/BT before earpiece; no explicit `selectAudioOutput("earpiece")`.
4. **Reconnect**: Only reconfigured preferences; did not re-select output.
5. **UI**: Updated route state before native success.

## Mute clarification

Existing Mute control uses mic icons and `setMicrophoneEnabled`. Per “do not silently change meaning,” Mute remains **mic mute**. It does not silence remote output or disconnect the room.

## Manual device tests

**PENDING** — see checklist; do not claim verified until physical-device audio is confirmed.
