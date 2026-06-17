import colors from "@/constants/colors";
import { useTheme } from "@/context/ThemeContext";

export function useColors() {
  const { isDark } = useTheme();
  return { ...(isDark ? colors.dark : colors.light), radius: colors.radius };
}
