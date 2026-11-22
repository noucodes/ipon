import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Body, Card, Empty, ErrorText, Ionicons, Label, Loading, Money } from '../../components/ui';
import { TransactionRow } from '../../components/TransactionRow';
import { OutboxBanner } from '../../components/Outbox';
import { DetectedList } from '../../components/DetectedList';
import { BigAmount } from '../../components/BigAmount';
import { Sparkline } from '../../components/Sparkline';
import { AccountAvatar } from '../../components/AccountAvatar';
import { useHousehold, useNetWorthHistory, useSummary } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { useDoubleTap } from '../../lib/useDoubleTap';
import { formatPHP, friendlyDate } from '../../lib/format';
import { useTheme, space, radius } from '../../theme';

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { user, isOwner } = useAuth();
  const summary = useSummary();
  const history = useNetWorthHistory(6);
  const household = useHousehold();
  const [hidden, setHidden] = useState(false);
  const doubleTap = useDoubleTap(() => router.push('/add'));
  const s = summary.data;
  const ownerName = household.data?.members.find((m) => m.role === 'owner')?.display_name;
  const monthNet = s?.month_flow.net_cents ?? 0;

  const refresh = () => Promise.all([summary.refetch(), history.refetch()]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }} {...doubleTap}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: 40, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={refresh} />}
      >
        {/* Hero balance card */}
        <View style={{ backgroundColor: t.hero, borderRadius: 30, padding: space.xl, paddingBottom: 34, gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={{ flex: 1, fontSize: 20, color: t.heroText, lineHeight: 26 }}>
              <Text style={{ fontWeight: '800' }}>{isOwner ? `Hi ${user?.display_name ?? ''}!` : `${ownerName ?? 'Partner'}'s`}</Text>
              <Text style={{ opacity: 0.55 }}>{isOwner ? ' Welcome\nto your wallet' : ' wallet\nview & log entries'}</Text>
            </Text>
            <Pressable
              onPress={() => setHidden((h) => !h)}
              accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.heroText} />
            </Pressable>
          </View>

          <View style={{ alignItems: 'center', gap: 6, marginTop: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: t.heroText, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: t.hero, fontWeight: '800', fontSize: 11 }}>₱</Text>
              </View>
              <Text style={{ color: t.heroText, opacity: 0.6, fontSize: 12, fontWeight: '600' }}>NET WORTH · PHP</Text>
            </View>
            {summary.isPending ? <Loading /> : hidden ? (
              <Text style={{ fontSize: 52, fontWeight: '800', color: t.heroText }}>₱ ••••••</Text>
            ) : (
              <BigAmount cents={s?.balances.net_worth_cents ?? 0} size={52} color={t.heroText} />
            )}
          </View>
        </View>

        {/* Month badge + action pills, overlapping the card edge */}
        <View style={{ marginTop: -46, gap: space.md }}>
          {s && (
            <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: monthNet >= 0 ? t.accent : t.expense, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 3, borderColor: t.bg }}>
              <Ionicons name={monthNet >= 0 ? 'trending-up' : 'trending-down'} size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                {hidden ? '••••' : `${monthNet >= 0 ? '+' : '−'}${formatPHP(Math.abs(monthNet))}`} this month
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <ActionPill icon="arrow-up" label="Expense" onPress={() => router.push('/add?type=expense')} />
            <Pressable
              onPress={() => router.push('/add?type=transfer')}
              accessibilityLabel="Transfer"
              style={({ pressed }) => ({ width: 58, height: 58, borderRadius: 20, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
            >
              <Ionicons name="swap-horizontal" size={24} color={t.text} />
            </Pressable>
            <ActionPill icon="arrow-down" label="Income" onPress={() => router.push('/add?type=income')} />
          </View>
        </View>

        <OutboxBanner />
        {isOwner && <DetectedList />}
        <ErrorText error={summary.error} />

        {s && (
          <>
            {/* Accounts + trend */}
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Card style={{ flex: 1, padding: space.md }} onPress={() => router.push('/accounts')}>
                <Text style={{ fontWeight: '800', color: t.text }}>Accounts</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  {s.balances.accounts.filter((a) => !a.archived).slice(0, 4).map((a) => (
                    <AccountAvatar key={a.id} account={a} size={40} showBalance={!hidden} onPress={() => router.push(`/account/${a.id}`)} />
                  ))}
                  {s.balances.accounts.length === 0 && <Body muted style={{ fontSize: 13 }}>Add your first account</Body>}
                </View>
              </Card>
              <Card style={{ flex: 1, padding: space.md }}>
                <Text style={{ fontWeight: '800', color: t.text }}>Net worth</Text>
                <Body muted style={{ fontSize: 12 }}>Last 6 months</Body>
                <Sparkline values={(history.data ?? []).map((p) => p.net_worth_cents)} color={t.accent} height={64} />
                <Text style={{ fontWeight: '800', color: t.text, fontSize: 15 }}>
                  {hidden ? '••••' : formatPHP(s.month_flow.income_cents)}
                  <Text style={{ fontWeight: '500', color: t.muted, fontSize: 12 }}> in this month</Text>
                </Text>
              </Card>
            </View>

            {/* Recent activity */}
            <View style={{ gap: space.sm }}>
              <Pressable onPress={() => router.push('/activity')} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, fontWeight: '800', fontSize: 17, color: t.text }}>Recent activity</Text>
                <Ionicons name="arrow-forward" size={20} color={t.text} />
              </Pressable>
              {s.recent_transactions.length === 0 ? (
                <Card><Empty title="No transactions yet" hint="Tap Expense or Income above, or double-tap anywhere." /></Card>
              ) : (
                s.recent_transactions.slice(0, 6).map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} card onPress={() => router.push(`/transaction/${tx.id}`)} />
                ))
              )}
            </View>

            {/* This month's spending */}
            {s.month_flow.spending_by_category.length > 0 && (
              <Card>
                <Label>Spending this month</Label>
                <Money cents={s.month_flow.expense_cents} size={22} weight="800" />
                {s.month_flow.spending_by_category.slice(0, 5).map((c) => (
                  <View key={c.category_id ?? 'none'} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Body>{c.name}</Body>
                      <Money cents={c.total_cents} />
                    </View>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.chip }}>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.expense, width: `${Math.max(3, (c.total_cents / Math.max(1, s.month_flow.expense_cents)) * 100)}%` }} />
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {s.recurring.upcoming.length > 0 && (
              <Card>
                <Label>Coming up (30 days)</Label>
                {s.recurring.upcoming.map((r) => (
                  <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Body>{r.name} <Body muted>· {friendlyDate(r.next_date)}</Body></Body>
                    <Money cents={r.amount_cents} kind={r.kind} signed />
                  </View>
                ))}
              </Card>
            )}
            <Body muted style={{ textAlign: 'center', fontSize: 12 }}>Tip: double-tap anywhere to add a transaction</Body>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionPill({ icon, label, onPress }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, height: 58, borderRadius: 20, backgroundColor: t.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.8 : 1 })}
    >
      <Text style={{ color: t.primaryText, fontWeight: '700', fontSize: 16 }}>{label}</Text>
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: t.primaryText, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={14} color={t.primaryText} />
      </View>
    </Pressable>
  );
}
