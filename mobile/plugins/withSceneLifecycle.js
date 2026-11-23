const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

/**
 * Adopts the UIKit scene life cycle, which the iOS 27 SDK requires: an app
 * built with it and still on the app-delegate life cycle traps at launch in
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before any
 * of our code runs ("UIScene life cycle is required for apps built with this
 * SDK"). Build 4 shipped that way from Xcode 27.
 *
 * Expo 57.0.33 ships the pieces (`ExpoAppSceneDelegate`,
 * `ExpoReactNativeFactoryProvider`) but its prebuild template does not use
 * them; the SDK 58 template does. This applies the SDK 58 template's shape:
 *
 *   - Info.plist declares a single-window scene manifest pointing at
 *     `SceneDelegate`.
 *   - `SceneDelegate.swift` subclasses `ExpoAppSceneDelegate`, which creates
 *     the window, starts React Native into it, and forwards URLs and user
 *     activities to the app delegate and `RCTLinkingManager` (so magic-link and
 *     Google sign-in redirects keep arriving).
 *   - `AppDelegate` conforms to `ExpoReactNativeFactoryProvider` and no longer
 *     creates the window itself.
 *
 * Delete this plugin when moving to SDK 58: its template does all of this.
 */
const SCENE_DELEGATE = `internal import Expo

// Added by plugins/withSceneLifecycle.js (scene life cycle, required by the iOS 27 SDK).
@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;

const WINDOW_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\n/;

function withSceneManifest(config) {
  return withInfoPlist(config, cfg => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, cfg => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    }
    let src = cfg.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(
        'class AppDelegate: ExpoAppDelegate {',
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
      );
    }
    if (WINDOW_BLOCK.test(src)) {
      src = src.replace(
        WINDOW_BLOCK,
        '    // The window is created and React Native is started by `SceneDelegate` under the\n' +
          '    // scene-based life cycle (required by the iOS 27 SDK).\n',
      );
    }
    // Loud rather than silent: a template change that defeats either edit
    // would ship an app that starts React Native twice, or never.
    if (!src.includes('ExpoReactNativeFactoryProvider') || src.includes('UIWindow(frame:')) {
      throw new Error('withSceneLifecycle: AppDelegate.swift did not match the expected template');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSceneDelegateFile(config) {
  config = withDangerousMod(config, [
    'ios',
    cfg => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      fs.writeFileSync(path.join(dir, 'SceneDelegate.swift'), SCENE_DELEGATE);
      return cfg;
    },
  ]);
  return withXcodeProject(config, cfg => {
    const name = cfg.modRequest.projectName;
    const filepath = `${name}/SceneDelegate.swift`;
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: name,
        project: cfg.modResults,
      });
    }
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneDelegateFile(withSceneAppDelegate(withSceneManifest(config)));
};
