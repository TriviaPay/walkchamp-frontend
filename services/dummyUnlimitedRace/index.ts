/**
 * Public entry for frontend-only Unlimited Race dummy sessions.
 * Keep all flag checks and generators behind this module.
 */

export {
  DUMMY_UNLIMITED_RACE_ID,
  DUMMY_PARTICIPANT_COUNT,
  DUMMY_CURRENT_USER_DEFAULT_RANK,
  createDummyUnlimitedParticipants,
  createDummyUnlimitedRaceSession,
  getDummyWaitingRoomParticipants,
  isDummyUnlimitedRaceId,
  shouldUseDummyUnlimitedRace,
  startDummyUnlimitedRaceSimulation,
  type DummyRaceData,
  type DummyRaceParticipant,
  type DummyUnlimitedRaceSession,
} from "./dummyUnlimitedRaceDataSource";
