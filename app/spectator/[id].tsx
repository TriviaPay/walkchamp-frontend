import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Legacy spectator route — redirects to the real race track / live board.
 * The old mock UI (fake comments, no race track) is no longer used.
 */
export default function SpectatorRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/(tabs)/live" />;
  return <Redirect href={{ pathname: "/race/live-detail", params: { id: String(id) } }} />;
}
