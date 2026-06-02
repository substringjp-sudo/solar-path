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
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000"
      },
      package: "com.pplaner.beforeglow",
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
      "@react-native-community/datetimepicker"
    ],
    extra: {
      eas: {
        projectId: "575ac16a-4ca5-4e70-9a12-cb7095f582a8"
      }
    }
  }
};
