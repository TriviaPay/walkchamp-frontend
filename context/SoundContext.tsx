import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { setHapticsEnabled } from "@/utils/haptics";

const STORAGE_KEY = "@walkchamp/vibrationEnabled";

interface HapticContextValue {
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
}

const SoundContext = createContext<HapticContextValue>({
  soundEnabled: true,
  setSoundEnabled: () => {},
});

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [soundEnabled, setSoundEnabledState] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val !== null) {
        const enabled = val === "true";
        setSoundEnabledState(enabled);
        setHapticsEnabled(enabled);
      }
    }).catch(() => {});
  }, []);

  const setSoundEnabled = useCallback((v: boolean) => {
    setSoundEnabledState(v);
    setHapticsEnabled(v);
    AsyncStorage.setItem(STORAGE_KEY, String(v)).catch(() => {});
  }, []);

  return (
    <SoundContext.Provider value={{ soundEnabled, setSoundEnabled }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound() {
  return useContext(SoundContext);
}
