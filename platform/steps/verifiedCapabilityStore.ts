/**
 * Device-scoped verified Health Connect capability.
 * Not user-account state — do not clear on login/logout.
 *
 * Native phone capture (SDK Extension 20) is stored/read separately via
 * hcOnDeviceSteps. This store only remembers that an unfiltered HC aggregate
 * has already returned steps from some contributor.
 */

import { storageGet, storageSet } from "@/utils/storage";
import type { VerifiedCapabilityKind } from "./stepProviderStateLogic";
import { resolveVerifiedCapabilityKind } from "./stepProviderStateLogic";

export type { VerifiedCapabilityKind };
export { resolveVerifiedCapabilityKind };

const KEY = "wc_device_verified_hc_capability" as never;

type Stored = {
  externalVerifiedSourceConfirmed: boolean;
  externalVerifiedSourceConfirmedAt: number | null;
};

let _mem: Stored | null = null;

async function load(): Promise<Stored> {
  if (_mem) return _mem;
  try {
    const stored = await storageGet<Stored>(KEY);
    _mem = {
      externalVerifiedSourceConfirmed: stored?.externalVerifiedSourceConfirmed === true,
      externalVerifiedSourceConfirmedAt:
        typeof stored?.externalVerifiedSourceConfirmedAt === "number"
          ? stored.externalVerifiedSourceConfirmedAt
          : null,
    };
  } catch {
    _mem = {
      externalVerifiedSourceConfirmed: false,
      externalVerifiedSourceConfirmedAt: null,
    };
  }
  return _mem;
}

export async function getExternalVerifiedSourceConfirmed(): Promise<boolean> {
  return (await load()).externalVerifiedSourceConfirmed;
}

/** Call when an unfiltered HC aggregate successfully returns steps > 0. */
export async function markExternalVerifiedSourceConfirmed(): Promise<void> {
  const next: Stored = {
    externalVerifiedSourceConfirmed: true,
    externalVerifiedSourceConfirmedAt: Date.now(),
  };
  _mem = next;
  try {
    await storageSet(KEY, next);
  } catch {
    /* keep memory */
  }
}
