import { Pressable, Text, View } from 'react-native';
import { Ionicons, Money } from './ui';
import { useTheme, space, radius } from '../theme';
import { useAuth } from '../lib/auth';

const ICON = { expense: 'arrow-up', income: 'arrow-down', transfer: 'swap-horizontal' };

/**
 * Activity row: round icon, title, details, amount.
 * `card` renders it as its own rounded card; `compact` is a slimmer row for short lists (Home).
 */
export function TransactionRow({ tx, onPress, showAuthor = true, card = false, compact = false }) {
  const t = useTheme();
  const { user } = useAuth();
  const color = t[tx.type];
  const title = tx.type === 'transfer'
    ? `${tx.account_name} → ${tx.to_account_name}`
    : tx.note || tx.category_name || (tx.type === 'income' ? 'Income' : 'Expense');
  const subtitle = [
    tx.type === 'transfer' ? tx.note : tx.note ? tx.category_name : null,
    tx.type !== 'transfer' ? tx.account_name : null,
    tx.type === 'transfer' && tx.fee_cents > 0 ? `fee ₱${(tx.fee_cents / 100).toFixed(2)}` : null,
    // Only mention who logged it when it wasn't you (e.g. your partner)
    showAuthor && tx.created_by && tx.created_by !== user?.id ? `by ${tx.created_by_name}` : null,
  ].filter(Boolean).join(' · ');
  const icon = compact ? 32 : 40;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: compact ? 10 : space.md, paddingVertical: compact ? 8 : 10, opacity: pressed ? 0.6 : 1 },
        card && { backgroundColor: t.card, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12 },
      ]}
    >
      <View style={{ width: icon, height: icon, borderRadius: icon / 2, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={ICON[tx.type]} size={compact ? 16 : 20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: compact ? 14 : 15, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {tx.pending && <Ionicons name="cloud-upload-outline" size={14} color={t.muted} accessibilityLabel="Not synced yet" />}
      <Money cents={tx.amount_cents} kind={tx.type === 'transfer' ? undefined : tx.type} signed={tx.type !== 'transfer'} size={compact ? 14 : 16} weight="800" />
    </Pressable>
  );
}
