import { Pressable, Text, View } from 'react-native';
import { Ionicons } from './ui';
import { ACCOUNT_TYPE_ICONS } from '../lib/format';
import { useTheme } from '../theme';

export const TYPE_COLORS = {
  bank: '#4F63E8',
  digital_bank: '#0EA5E9',
  cash: '#2F9E55',
  credit_card: '#E0533D',
  savings: '#A855F7',
  person: '#F59E0B',
};

/** Round account "contact" like a recipient avatar. */
export function AccountAvatar({ account, selected, onPress, size = 54, showBalance = true, dimmed }) {
  const t = useTheme();
  const color = TYPE_COLORS[account.type] ?? t.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={account.name}
      style={({ pressed }) => ({ alignItems: 'center', width: size + 26, gap: 4, opacity: dimmed ? 0.35 : pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: selected ? color : t.card,
          borderWidth: 2,
          borderColor: selected ? color : t.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={account.is_private ? 'lock-closed' : ACCOUNT_TYPE_ICONS[account.type]} size={size * 0.42} color={selected ? '#fff' : color} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: selected ? '800' : '600', color: t.text }}>{account.name}</Text>
      {showBalance && account.balance_cents != null && (
        <Text numberOfLines={1} style={{ fontSize: 11, color: t.muted }}>
          ₱{Math.round(account.balance_cents / 100).toLocaleString('en-PH')}
        </Text>
      )}
    </Pressable>
  );
}
