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

const withRemoveUnusedPermissions = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    if (!androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }
    // Remove ACTIVITY_RECOGNITION
    androidManifest.manifest['uses-permission'].push({
      $: {
        'android:name': 'android.permission.ACTIVITY_RECOGNITION',
        'tools:node': 'remove'
      }
    });
    // Remove READ_MEDIA_VIDEO
    androidManifest.manifest['uses-permission'].push({
      $: {
        'android:name': 'android.permission.READ_MEDIA_VIDEO',
        'tools:node': 'remove'
      }
    });
    // Remove READ_MEDIA_AUDIO
    androidManifest.manifest['uses-permission'].push({
      $: {
        'android:name': 'android.permission.READ_MEDIA_AUDIO',
        'tools:node': 'remove'
      }
    });
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
      resizeMode: "cover",
      backgroundColor: "#F4EBE6"
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
        NSPhotoLibraryAddUsageDescription: "BeforeGlow requires permission to save beautiful sunset photos to your photo library.",
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      package: "com.pplaner.beforeglow",
      versionCode: 14,
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
      withKotlinJvmTargetFix,
      withRemoveUnusedPermissions,
      "expo-splash-screen",
      "@react-native-community/datetimepicker",
      [
        "expo-media-library",
        {
          "photosPermission": "Allow BeforeGlow to access your photos.",
          "savePhotosPermission": "Allow BeforeGlow to save photos to your library."
        }
      ]
    ],
    runtimeVersion: "1.0.0",
    updates: {
      url: "https://u.expo.dev/575ac16a-4ca5-4e70-9a12-cb7095f582a8"
    },
    extra: {
      eas: {
        projectId: "575ac16a-4ca5-4e70-9a12-cb7095f582a8"
      }
    }
  }
};
