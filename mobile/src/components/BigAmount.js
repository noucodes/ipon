import { Text, View } from 'react-native';
import { useTheme } from '../theme';

/** "₱12,329.20" with the centavos smaller and raised: ₱12,329 .20 */
export function BigAmount({ cents, size = 44, color, showSign = false }) {
  const t = useTheme();
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-PH');
  const frac = String(abs % 100).padStart(2, '0');
  const c = color ?? t.text;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }} accessibilityLabel={`${negative ? 'minus ' : ''}${whole} pesos ${frac} centavos`}>
      <Text style={{ fontSize: size, fontWeight: '800', color: c, letterSpacing: -1, fontVariant: ['tabular-nums'] }}>
        {negative ? '−' : showSign ? '+' : ''}₱{whole}
      </Text>
      <Text style={{ fontSize: size * 0.42, fontWeight: '700', color: c, opacity: 0.55, marginTop: size * 0.12, marginLeft: 2 }}>.{frac}</Text>
    </View>
  );
}
