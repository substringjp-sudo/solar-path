const { withAndroidManifest, withProjectBuildGradle } = require("expo/config-plugins");

const withKotlinJvmTargetFix = (config) => {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      let contents = config.modResults.contents;
      const jvmTargetConfig = `
allprojects {
  tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions {
      jvmTarget = "17"
    }
  }
}
`;
      if (!contents.includes("KotlinCompile")) {
        contents += jvmTargetConfig;
      }
      config.modResults.contents = contents;
    }
    return config;
  });
};

const withAndroidDynamicIconFix = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    const activities = mainApplication.activity || [];
    const activityAliases = mainApplication["activity-alias"] || [];

    // 1. MainActivity에서 LAUNCHER 인텐트 필터 제거
    const mainActivity = activities.find(
      (activity) => activity.$["android:name"] === ".MainActivity"
    );
    if (mainActivity && mainActivity["intent-filter"]) {
      mainActivity["intent-filter"] = mainActivity["intent-filter"].filter((filter) => {
        const categories = filter.category || [];
        const isLauncher = categories.some(
          (category) => category.$["android:name"] === "android.intent.category.LAUNCHER"
        );
        return !isLauncher;
      });
    }

    // 2. 처음 설치 시 활성화될 기본 앨리어스를 spiconclear로 지정하여 enabled="true"로 설정
    const targetAliasName = "com.pplaner.beforeglow.MainActivityspiconclear";
    const targetAlias = activityAliases.find(
      (alias) => alias.$["android:name"] === targetAliasName
    );
    if (targetAlias) {
      targetAlias.$["android:enabled"] = "true";
    }

    return config;
  });
};

module.exports = {
  expo: {
    name: "BeforeGlow",
    slug: "beforeglow",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#000000"
    },
    notification: {
      icon: "./assets/notification_icon.png",
      color: "#ff7b54"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.pplaner.beforeglow",
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
      },
      infoPlist: {
        NSLocationWhenInUseUsageDescription: "BeforeGlow requires location access to calculate accurate sunrise/sunset times and display isochrone maps for your current spot.",
        NSCameraUsageDescription: "BeforeGlow requires camera access to take beautiful photos of the sunset and share them with the community.",
        NSPhotoLibraryUsageDescription: "BeforeGlow requires photo library access to select and upload your saved sunset photos.",
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      package: "com.pplaner.beforeglow",
      versionCode: 5,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#D49A1F"
      },
      googleServicesFile: "./google-services.json",
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
        }
      },
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE"
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    plugins: [
      withAndroidDynamicIconFix,
      withKotlinJvmTargetFix,
      "expo-splash-screen",
      "@react-native-community/datetimepicker",
      [
        "expo-dynamic-app-icon",
        {
          "spiconmuted": { "image": "./assets/icon_muted.png" },
          "spiconclear": { "image": "./assets/icon_clear.png" },
          "spiconepic": { "image": "./assets/icon_epic.png" }
        }
      ]
    ],
    extra: {
      eas: {
        projectId: "575ac16a-4ca5-4e70-9a12-cb7095f582a8"
      }
    }
  }
};
