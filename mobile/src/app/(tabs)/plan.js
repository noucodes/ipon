import { RefreshControl, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Button, Card, Empty, ErrorText, IconButton, Label, Loading, Money, Screen, Title } from '../../components/ui';
import { useRecurring, useSummary } from '../../lib/queries';
import { PayrollPlanCard } from '../../components/MoneyPlan';
import { useAuth } from '../../lib/auth';
import { formatPHP, friendlyDate, scheduleLabel } from '../../lib/format';
import { space } from '../../theme';

export default function Plan() {
  const router = useRouter();
  const { isOwner } = useAuth();
  const q = useRecurring();
  const summary = useSummary();
  const items = q.data ?? [];
  const active = items.filter((i) => i.active && !i.paid_off);
  const income = active.filter((i) => i.kind === 'income');
  const bills = active.filter((i) => i.kind === 'expense');
  const sum = (list) => list.reduce((n, i) => n + i.monthly_equivalent_cents, 0);
  const net = sum(income) - sum(bills);

  const Row = ({ item }) => (
    <Pressable
      onPress={() => router.push(`/recurring/${item.id}`)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: space.sm, opacity: !item.active || item.paid_off ? 0.45 : pressed ? 0.6 : 1 })}
    >
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: '600' }}>{item.name}</Body>
        <Body muted style={{ fontSize: 13 }}>
          {scheduleLabel(item)}
          {item.next_date ? ` · next ${friendlyDate(item.next_date)}` : ''}
          {!item.active ? ' · paused' : ''}
          {item.paid_off ? ' · paid off 🎉' : ''}
        </Body>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Money cents={item.expected_cents ?? item.amount_cents} kind={item.kind} />
        {item.average_net_cents != null && <Body muted style={{ fontSize: 11 }}>avg of recent payslips</Body>}
        {item.frequency !== 'monthly' && <Body muted style={{ fontSize: 12 }}>≈ {formatPHP(item.monthly_equivalent_cents)}/mo</Body>}
      </View>
      {isOwner && item.kind === 'income' && (
        <IconButton icon="add-circle-outline" label={`Log ${item.name}`} onPress={() => router.push(`/add?type=income&amount=${item.expected_cents ?? item.amount_cents}&recurring=${item.id}`)} />
      )}
    </Pressable>
  );

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => Promise.all([q.refetch(), summary.refetch()])} />}>
      <Title right={isOwner && <IconButton icon="add-circle" label="Add income or bill" onPress={() => router.push('/recurring/new')} />}>Income & Bills</Title>
      {q.isPending && <Loading />}
      <ErrorText error={q.error} />

      {isOwner && (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Payslips & deductions" variant="secondary" icon="pie-chart-outline" onPress={() => router.push('/payslips')} style={{ flex: 1 }} />
        </View>
      )}

      {q.data && (
        <Card>
          <Label>Every month (estimated)</Label>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}><Body muted>Income</Body><Money cents={sum(income)} kind="income" size={18} /></View>
            <View style={{ flex: 1 }}><Body muted>Bills</Body><Money cents={sum(bills)} kind="expense" size={18} /></View>
            <View style={{ flex: 1 }}><Body muted>Can save</Body><Money cents={net} size={18} /></View>
          </View>
        </Card>
      )}

      {summary.data?.plan && items.length > 0 && <PayrollPlanCard plan={summary.data.plan} />}

      {q.data && items.length === 0 && (
        <Empty
          icon="calendar-outline"
          title="Add your salary and regular bills"
          hint="e.g. Salary twice a month, rent, Meralco, internet, Netflix. You'll see what you can save each month."
          action={isOwner && <Button title="Add" icon="add" onPress={() => router.push('/recurring/new')} />}
        />
      )}

      {items.some((i) => i.kind === 'income') && (
        <Card>
          <Label>Income</Label>
          {items.filter((i) => i.kind === 'income').map((i) => <Row key={i.id} item={i} />)}
        </Card>
      )}
      {items.some((i) => i.kind === 'expense') && (
        <Card>
          <Label>Bills & subscriptions</Label>
          {items.filter((i) => i.kind === 'expense').map((i) => <Row key={i.id} item={i} />)}
        </Card>
      )}
    </Screen>
  );
}
