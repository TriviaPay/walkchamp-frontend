import React from "react";
import { Redirect } from "expo-router";

/** Alias route so in-app deep links can use `/privacy` or `/privacy-policy`. */
export default function PrivacyAlias() {
  return <Redirect href="/legal" />;
}
