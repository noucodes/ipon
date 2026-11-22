import { useColorScheme } from 'react-native';

// Soft neutral greys, a lavender hero card, near-black pill buttons and a green accent.
const light = {
  bg: '#EDEEF1',
  card: '#FFFFFF',
  text: '#16161A',
  muted: '#6E6E78',
  border: '#E2E3E8',
  primary: '#1C1C22', // dark pill buttons
  primaryText: '#FFFFFF',
  primarySoft: '#E4E3F5',
  hero: '#D9D8F0', // lavender balance card
  heroText: '#16161A',
  accent: '#3FA34D', // green pill / positive
  accentText: '#FFFFFF',
  income: '#2F9E55',
  expense: '#E0533D',
  transfer: '#4F63E8',
  danger: '#D03A2B',
  chip: '#E6E7EC',
  key: '#F4F4F7', // keypad keys
};

const dark = {
  bg: '#0E0E11',
  card: '#1A1A1F',
  text: '#F2F2F5',
  muted: '#9A9AA6',
  border: '#2A2A31',
  primary: '#ECEBFF',
  primaryText: '#16161A',
  primarySoft: '#2A2940',
  hero: '#2C2B42',
  heroText: '#F2F2F5',
  accent: '#58C46A',
  accentText: '#0E0E11',
  income: '#4CD07A',
  expense: '#FF7A63',
  transfer: '#8C9BFF',
  danger: '#FF6B5E',
  chip: '#24242B',
  key: '#1F1F25',
};

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };
