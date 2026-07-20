/** Sponsored event is still before its scheduled start time. */
export function isBeforeScheduledStart(scheduledStartAt: string | null | undefined): boolean {
  if (!scheduledStartAt) return true;
  return new Date(scheduledStartAt).getTime() > Date.now();
}

/** Registration stays open until the race starts (not limited to a 10-minute pre-start window). */
export function isSponsoredRegistrationOpen(ev: {
  status: string;
  isRegistered?: boolean;
  isFull?: boolean;
  scheduledStartAt?: string | null;
}): boolean {
  if (ev.status !== "scheduled") return false;
  if (ev.isRegistered || ev.isFull) return false;
  return isBeforeScheduledStart(ev.scheduledStartAt);
}

/** Registered users can open the waiting room any time before the race starts. */
export function canOpenSponsoredWaitingRoom(ev: {
  status: string;
  isRegistered?: boolean;
  scheduledStartAt?: string | null;
}): boolean {
  if (!ev.isRegistered || ev.status !== "scheduled") return false;
  return isBeforeScheduledStart(ev.scheduledStartAt);
}
