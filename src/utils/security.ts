import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { xorHexEncode, xorHexDecode } from './xorHex';

const SECRET_SALT = 'BeforeGlowSecuritySalt_2026_SolarPath';

/**
 * Builds a dynamic salt string using hardcoded secret combined with
 * device OS, OS version, and Expo SDK version.
 * This prevents the key from being completely uniform and static across devices.
 */
const buildSalt = (): string => {
  const sdk = Constants.expoConfig?.sdkVersion || '54';
  const os = Platform.OS;
  const osVer = Platform.Version?.toString() || '';
  return `${SECRET_SALT}_${os}_${osVer}_${sdk}`;
};

/**
 * Encrypts a plain text string into a hex representation using XOR cipher with a dynamic key.
 * This prevents plain-text exposure in local databases (AsyncStorage).
 */
export const encryptData = (text: string): string => xorHexEncode(text, buildSalt());

/**
 * Decrypts a hex cipher text back into plain text string.
 */
export const decryptData = (hex: string): string => xorHexDecode(hex, buildSalt());
