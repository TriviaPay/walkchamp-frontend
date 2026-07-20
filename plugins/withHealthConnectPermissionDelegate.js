const { withMainActivity } = require("@expo/config-plugins");

const HC_IMPORT =
  "import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate";
const HC_DELEGATE = "HealthConnectPermissionDelegate.setPermissionDelegate(this)";

/**
 * Registers Health Connect's ActivityResultLauncher on MainActivity AFTER super.onCreate.
 * Registering before super.onCreate invalidates the launcher and breaks permission requests.
 */
function withHealthConnectPermissionDelegate(config) {
  return withMainActivity(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (!contents.includes(HC_IMPORT)) {
      contents = contents.replace(
        /import com\.facebook\.react\.ReactActivity\n/,
        `${HC_IMPORT}\nimport com.facebook.react.ReactActivity\n`,
      );
    }

    // Remove stale pre-super.onCreate injection from older builds
    contents = contents.replace(
      /\n\s*\/\/ Health Connect permission contract must register before activity STARTED\.\s*\n\s*HealthConnectPermissionDelegate\.setPermissionDelegate\(this\)\s*\n(\s*)(super\.onCreate\([^)]*\))/,
      "\n$1$2",
    );

    if (!contents.includes(HC_DELEGATE)) {
      contents = contents.replace(
        /(\s+)(super\.onCreate\([^)]*\))/,
        `$1$2\n$1${HC_DELEGATE}`,
      );
    }

    // Remove duplicate delegate lines
    contents = contents.replace(
      /\n(\s*)HealthConnectPermissionDelegate\.setPermissionDelegate\(this\)\s*\n\1HealthConnectPermissionDelegate\.setPermissionDelegate\(this\)/,
      "\n$1HealthConnectPermissionDelegate.setPermissionDelegate(this)",
    );

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = withHealthConnectPermissionDelegate;
