/** @deprecated Import from @/services/permissions/notificationGate instead. */
export {
  NOTIFICATION_STILL_DISABLED_MESSAGE,
  STEP_TRACKING_NOTIFICATION_STILL_DISABLED_MESSAGE,
  checkNotificationStatus,
  ensureNotificationsForStepTracking,
  ensureOngoingNotificationAccessForStepTracking,
  handleAppResumeNotificationRecheck,
  handleAppStateActiveForStepTrackingNotificationGate,
  hasOngoingNotificationAccess,
  onStepTrackingNotificationDismiss,
  onStepTrackingNotificationOpenSettings,
  openNotificationSettings,
  registerStepTrackingNotificationModalHost,
  unregisterStepTrackingNotificationModal,
  type NotificationGateResult,
} from "@/services/permissions/notificationGate";
