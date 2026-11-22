import { Pressable, Text, View } from 'react-native';
import { Ionicons, Money } from './ui';
import { useTheme, space, radius } from '../theme';

const ICON = { expense: 'arrow-up', income: 'arrow-down', transfer: 'swap-horizontal' };

/** Activity row: round icon, title, details, amount. `card` renders it as its own white rounded card. */
export function TransactionRow({ tx, onPress, showAuthor = true, card = false }) {
  const t = useTheme();
  const color = t[tx.type];
  const title = tx.type === 'transfer'
    ? `${tx.account_name} → ${tx.to_account_name}`
    : tx.note || tx.category_name || (tx.type === 'income' ? 'Income' : 'Expense');
  const subtitle = [
    tx.type === 'transfer' ? tx.note : tx.note ? tx.category_name : null,
    tx.type !== 'transfer' ? tx.account_name : null,
    tx.type === 'transfer' && tx.fee_cents > 0 ? `fee ₱${(tx.fee_cents / 100).toFixed(2)}` : null,
    showAuthor ? tx.created_by_name : null,
  ].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10, opacity: pressed ? 0.6 : 1 },
        card && { backgroundColor: t.card, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12 },
      ]}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={ICON[tx.type]} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>}
      </View>
      <Money cents={tx.amount_cents} kind={tx.type === 'transfer' ? undefined : tx.type} signed={tx.type !== 'transfer'} size={16} weight="800" />
    </Pressable>
  );
}
