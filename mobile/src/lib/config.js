import Constants from 'expo-constants';

/**
 * API base URL.
 * - EXPO_PUBLIC_API_URL if set (use your Render URL for real builds).
 * - Otherwise in development: the computer running `expo start`, port 4000,
 *   so the phone on the same Wi-Fi reaches your local API.
 */
function resolveApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:4000`;
}

export const API_URL = resolveApiUrl();
