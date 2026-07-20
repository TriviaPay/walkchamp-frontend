const { withFinalizedMod } = require("@expo/config-plugins");
const {
  syncWalkChampProgressIcons,
} = require("../scripts/sync-walk-champ-progress-icons");

/**
 * After expo-alternate-app-icons generates placeholder mipmaps from app.json,
 * overwrite them with the full icon sets under android/app/src/main/WalkChampProgress folders.
 */
function withWalkChampProgressIcons(config) {
  return withFinalizedMod(config, [
    "android",
    async (cfg) => {
      syncWalkChampProgressIcons(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
}

module.exports = withWalkChampProgressIcons;
