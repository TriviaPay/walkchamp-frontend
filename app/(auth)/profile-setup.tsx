// Redirects to the new complete-profile screen — kept for backward navigation compat
import { Redirect } from "expo-router";
export default function ProfileSetupRedirect() {
  return <Redirect href="/(auth)/complete-profile" />;
}
