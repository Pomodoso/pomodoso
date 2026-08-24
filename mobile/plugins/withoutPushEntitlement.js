const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Strips the Push Notifications entitlement (`aps-environment`).
 *
 * expo-notifications adds it through autolinking — it isn't even listed in
 * app.json's plugins — but the app only ever schedules *local* notifications
 * (notifications.ts, utils/ongoingNotification.ts). Remote push needs an APNs
 * key, which needs a paid Apple Developer Program membership, so a free
 * provisioning profile refuses to sign a build that declares it:
 *
 *   Provisioning Profile "iOS Team Provisioning Profile: com.pomodoso.app"
 *   does not support the Push Notifications capability.
 *
 * Declaring a capability the app never exercises also gets flagged in App
 * Store review, so this is the right shape regardless of the account.
 *
 * Remove this plugin when remote push actually lands (fase M3 — habit
 * reminders and meeting-end alerts), together with the APNs credentials.
 *
 * MUST stay first in app.json's plugins array. Expo runs mods in the reverse
 * of the order they're registered, so the first plugin listed is the last one
 * to touch the entitlements — which is the only position from which this can
 * delete a key expo-notifications adds. Listed last, it runs against an empty
 * plist and silently does nothing.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, cfg => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
