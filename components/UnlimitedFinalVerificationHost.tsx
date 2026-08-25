import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  startUnlimitedFinalVerificationCoordinator,
  stopUnlimitedFinalVerificationCoordinator,
} from "@/services/unlimitedFinalVerificationCoordinator";

/** Binds Streak final-verification to authenticated app start / logout. */
export function UnlimitedFinalVerificationHost() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user?.id) {
      stopUnlimitedFinalVerificationCoordinator();
      return;
    }
    startUnlimitedFinalVerificationCoordinator(user.id);
    return () => {
      stopUnlimitedFinalVerificationCoordinator();
    };
  }, [user?.id, loading]);

  return null;
}
