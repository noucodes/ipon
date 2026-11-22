import { NativeModules } from 'react-native';
import Constants from 'expo-constants';

/** Host of the computer serving the JS bundle in development, e.g. "192.168.1.56". */
function devServerHost() {
  // 1) Expo config (Expo Go and most dev builds): "192.168.1.56:8081"
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  if (hostUri) return hostUri.split(':')[0];
  // 2) Where this JS bundle was downloaded from: "http://192.168.1.56:8081/index.bundle?..."
  const scriptURL = NativeModules.SourceCode?.getConstants?.().scriptURL ?? NativeModules.SourceCode?.scriptURL;
  const match = typeof scriptURL === 'string' && scriptURL.match(/^https?:\/\/([^/:]+)/);
  if (match && match[1] !== 'localhost' && match[1] !== '127.0.0.1') return match[1];
  return null;
}

/**
 * API base URL.
 * - EXPO_PUBLIC_API_URL if set (your Render URL for real builds).
 * - Otherwise in development: the computer running `expo start`, port 4000,
 *   so the phone on the same Wi-Fi reaches your local API.
 */
function resolveApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return `http://${devServerHost() ?? 'localhost'}:4000`;
}

export const API_URL = resolveApiUrl();
