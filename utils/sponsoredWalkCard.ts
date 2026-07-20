import {
  isSponsoredRegistrationOpen,
  canOpenSponsoredWaitingRoom,
} from "@/utils/sponsoredEventRegistration";

export type SponsoredCardStatus =
  | {
      kind: "racing";
      eventId: string;
      registeredCount?: number;
      maxSlots?: number;
      targetSteps?: number;
      prizePoolCents?: number;
      prizePerWinnerCents?: number;
    }
  | {
      kind: "join_window";
      eventId: string;
      scheduledStartAt?: string | null;
      registeredCount: number;
      maxSlots: number;
      targetSteps?: number;
      prizePoolCents?: number;
      prizePerWinnerCents?: number;
    }
  | {
      kind: "registered";
      eventId: string;
      scheduledStartAt: string;
      registeredCount: number;
      maxSlots: number;
      targetSteps?: number;
      prizePoolCents?: number;
      prizePerWinnerCents?: number;
    }
  | { kind: "available"; eventId: string; registeredCount: number; maxSlots: number }
  | { kind: "watch_live"; eventId: string };

type SponsoredEventLike = {
  id: string;
  status: string;
  isRegistered: boolean;
  isActive: boolean;
  joinWindowOpen: boolean;
  canRegister: boolean;
  scheduledStartAt: string | null;
  registeredCount: number;
  maxSlots: number;
  targetSteps?: number;
  prizePoolCents?: number;
  prizePerWinnerCents?: number;
};

/** Same priority rules previously inlined on the Walk tab. */
export function mapSponsoredEventsToCardStatus(
  events: SponsoredEventLike[] | undefined | null,
): SponsoredCardStatus | null {
  const evs = events ?? [];
  for (const ev of evs) {
    if (ev.status === "in_progress" && ev.isActive) {
      return {
        kind: "racing",
        eventId: ev.id,
        registeredCount: ev.registeredCount,
        maxSlots: ev.maxSlots,
        targetSteps: ev.targetSteps,
        prizePoolCents: ev.prizePoolCents,
        prizePerWinnerCents: ev.prizePerWinnerCents,
      };
    }
  }
  for (const ev of evs) {
    if (canOpenSponsoredWaitingRoom(ev) && ev.joinWindowOpen) {
      return {
        kind: "join_window",
        eventId: ev.id,
        scheduledStartAt: ev.scheduledStartAt,
        registeredCount: ev.registeredCount,
        maxSlots: ev.maxSlots,
        targetSteps: ev.targetSteps,
        prizePoolCents: ev.prizePoolCents,
        prizePerWinnerCents: ev.prizePerWinnerCents,
      };
    }
  }
  for (const ev of evs) {
    if (canOpenSponsoredWaitingRoom(ev)) {
      return {
        kind: "registered",
        eventId: ev.id,
        scheduledStartAt: ev.scheduledStartAt!,
        registeredCount: ev.registeredCount,
        maxSlots: ev.maxSlots,
        targetSteps: ev.targetSteps,
        prizePoolCents: ev.prizePoolCents,
        prizePerWinnerCents: ev.prizePerWinnerCents,
      };
    }
  }
  for (const ev of evs) {
    if (isSponsoredRegistrationOpen(ev)) {
      return {
        kind: "available",
        eventId: ev.id,
        registeredCount: ev.registeredCount,
        maxSlots: ev.maxSlots,
      };
    }
  }
  for (const ev of evs) {
    if (ev.status === "in_progress" && !ev.isActive && !ev.isRegistered) {
      return { kind: "watch_live", eventId: ev.id };
    }
  }
  return null;
}
