// JS side of the native WalletShortcuts module (Android only).
// Every function is a safe no-op where the native module isn't present
// (Expo Go, iOS), so the rest of the app never has to check.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

const Native = Platform.OS === 'android' ? requireOptionalNativeModule('WalletShortcuts') : null;

export const isAvailable = Boolean(Native);

/** Update the home-screen widget text. */
export function updateWidget({ title, amount, subtitle = '' }) {
  try {
    Native?.updateWidget(title, amount, subtitle);
  } catch (e) {
    console.warn('updateWidget failed', e);
  }
}

/** Register long-press app icon shortcuts. */
export function setShortcuts() {
  try {
    Native?.setShortcuts();
  } catch (e) {
    console.warn('setShortcuts failed', e);
  }
}

// StatusBarManager.requestAddTileService result codes
export const TILE_RESULT = { UNSUPPORTED: -1, NOT_ADDED: 0, ALREADY_ADDED: 1, ADDED: 2 };

/** Ask Android (13+) to add the "Add transaction" tile to the pull-down panel. */
export async function requestAddTile() {
  if (!Native) return TILE_RESULT.UNSUPPORTED;
  try {
    return await Native.requestAddTile();
  } catch {
    return TILE_RESULT.UNSUPPORTED;
  }
}

// --- Payment detection (GCash / Maya / bank alerts) ---

const safe = (fn, fallback) => {
  try {
    return Native ? fn() : fallback;
  } catch (e) {
    console.warn('WalletShortcuts call failed', e);
    return fallback;
  }
};

export const detection = {
  hasAccess: () => safe(() => Native.hasDetectionAccess(), false),
  openSettings: () => safe(() => Native.openDetectionSettings(), undefined),
  isActive: () => safe(() => Native.isDetectionActive(), false),
  setActive: (on) => safe(() => Native.setDetectionActive(Boolean(on)), undefined),
  /** [{ id, source, type, amount_cents, text, posted_at }] newest first */
  list: () => safe(() => JSON.parse(Native.getDetections()), []),
  remove: (id) => safe(() => Native.removeDetection(String(id)), undefined),
  clear: () => safe(() => Native.clearDetections(), undefined),
};

/** Ask the launcher to place the widget. Returns false if the launcher doesn't support it. */
export function requestPinWidget() {
  try {
    return Native ? Native.requestPinWidget() : false;
  } catch {
    return false;
  }
}
