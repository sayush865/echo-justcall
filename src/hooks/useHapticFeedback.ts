import { useCallback } from "react";

type HapticStyle = "light" | "medium" | "heavy";

const vibrationDurations: Record<HapticStyle, number> = {
  light: 10,
  medium: 20,
  heavy: 30,
};

export const useHapticFeedback = () => {
  const trigger = useCallback((style: HapticStyle = "light") => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(vibrationDurations[style]);
    }
  }, []);

  return { trigger };
};

// Standalone function for use outside React components
export const triggerHaptic = (style: HapticStyle = "light") => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(vibrationDurations[style]);
  }
};
