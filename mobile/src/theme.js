import { useColorScheme } from 'react-native';

// Ipon brand: green #0B6B4F, gold #F5C542, text #111827.
// Dark is the main look: near-black with a hint of green, a brand-green balance card
// and gold pill buttons.
export const BRAND = { green: '#0B6B4F', gold: '#F5C542', ink: '#111827' };

const dark = {
  bg: '#0A0F0D',
  card: '#141B18',
  text: '#F2F5F3',
  muted: '#93A09A',
  border: '#232D29',
  primary: BRAND.gold, // pill buttons, selected chips
  primaryText: BRAND.ink,
  primarySoft: '#1C2823',
  hero: BRAND.green, // balance card
  heroText: '#FFFFFF',
  accent: '#2EBD7A', // positive pill, progress, switches
  accentText: '#FFFFFF',
  gold: BRAND.gold,
  income: '#3DD68C',
  expense: '#FF7A6B',
  transfer: '#6CA8FF',
  danger: '#FF6B5E',
  chip: '#1B2420',
  key: '#18201D', // keypad keys
};

const light = {
  bg: '#F2F6F4',
  card: '#FFFFFF',
  text: BRAND.ink,
  muted: '#6B7280',
  border: '#E1E7E4',
  primary: BRAND.green,
  primaryText: '#FFFFFF',
  primarySoft: '#E2F1EB',
  hero: BRAND.green,
  heroText: '#FFFFFF',
  accent: '#16935F',
  accentText: '#FFFFFF',
  gold: '#E0A800',
  income: '#16935F',
  expense: '#DC4B3A',
  transfer: '#3B6FE0',
  danger: '#D03A2B',
  chip: '#E7EDEA',
  key: '#F1F5F3',
};

export function useTheme() {
  return useColorScheme() === 'light' ? light : dark;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };

/** True when the app is showing its dark design (the default). */
export function useIsDark() {
  return useColorScheme() !== 'light';
}
