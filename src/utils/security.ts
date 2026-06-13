import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
export const encryptData = (text: string): string => {
  if (!text) return '';
  const salt = buildSalt();
  // Convert full unicode string into a safe ascii URI-encoded representation
  const utf8Text = encodeURIComponent(text);
  let result = '';
  for (let i = 0; i < utf8Text.length; i++) {
    const charCode = utf8Text.charCodeAt(i) ^ salt.charCodeAt(i % salt.length);
    result += String.fromCharCode(charCode);
  }
  return toHexString(result);
};

/**
 * Decrypts a hex cipher text back into plain text string.
 */
export const decryptData = (hex: string): string => {
  if (!hex) return '';
  const salt = buildSalt();
  const text = fromHexString(hex);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ salt.charCodeAt(i % salt.length);
    result += String.fromCharCode(charCode);
  }
  return decodeURIComponent(result);
};

const toHexString = (str: string): string => {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const hex = str.charCodeAt(i).toString(16);
    // Pad to 2 hex characters
    result += ('0' + hex).slice(-2);
  }
  return result;
};

const fromHexString = (hex: string): string => {
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    const charCode = parseInt(hex.substring(i, i + 2), 16);
    result += String.fromCharCode(charCode);
  }
  return result;
};
