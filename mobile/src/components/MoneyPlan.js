// Today's budget, the next-payday preview (Home) and the full payroll plan (Plan tab).
// All numbers come from summary.plan (shared/src/plan.js), so phone and web agree.
import { Text, View } from 'react-native';
import { Card, Ionicons, Money } from './ui';
import { formatPHP, friendlyDate } from '../lib/format';
import { useTheme, space } from '../theme';

const PRIORITY_COLOR = { debt: '#E0614F', home: '#4F8AE6', essential: '#B08820', flexible: '#9A7BE0' };
const PRIORITY_ICON = { debt: 'card-outline', home: 'home-outline', essential: 'wifi-outline', flexible: 'pause-circle-outline' };

function statusLook(t, status) {
  switch (status) {
    case 'ok': return { color: t.income, icon: 'checkmark-circle', label: 'On track' };
    case 'near': return { color: t.gold, icon: 'alert-circle', label: 'Almost at your limit' };
    case 'over': return { color: t.expense, icon: 'warning', label: 'Over budget' };
    case 'way_over': return { color: t.danger, icon: 'flame', label: 'Way over budget' };
    default: return { color: t.danger, icon: 'alert-circle', label: 'Bills need all your money' };
  }
}

const mask = (hidden, cents) => (hidden ? '••••' : formatPHP(cents));

/** "Today": spent vs. what you can spend per day until payday. */
export function TodayBudgetCard({ plan, hidden, onPress }) {
  const t = useTheme();
  const d = plan.today;
  const look = statusLook(t, d.status);
  const budget = plan.daily_budget_cents;
  const pct = budget > 0 ? Math.min(1, d.everyday_cents / budget) : d.everyday_cents > 0 ? 1 : 0;
  const times = budget > 0 ? d.everyday_cents / budget : 0;
  const until = plan.payday ? `payday ${friendlyDate(plan.payday)}` : 'the end of the month';

  const headline = d.status === 'short'
    ? `${mask(hidden, -plan.safe_to_spend_cents)} short for bills before ${plan.payday ? 'payday' : 'month end'}`
    : d.left_cents >= 0
    ? `${mask(hidden, d.left_cents)} left to spend today`
    : `Over by ${mask(hidden, -d.left_cents)}${d.status === 'way_over' && !hidden ? ` · ${times.toFixed(1)}× your daily budget` : ''}`;

  return (
    <Card onPress={onPress} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontWeight: '800', fontSize: 16, color: t.text }}>Today</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={look.icon} size={16} color={look.color} />
          <Text style={{ color: look.color, fontWeight: '700', fontSize: 13 }}>{look.label}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>Spent today</Text>
          {hidden
            ? <Text style={{ fontSize: 26, fontWeight: '800', color: t.text }}>••••</Text>
            : <Money cents={d.everyday_cents} size={26} weight="800" />}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>{plan.budget_mode === 'fixed' ? 'Your daily budget' : 'Daily budget'}</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.text, fontVariant: ['tabular-nums'] }}>{mask(hidden, budget)}</Text>
        </View>
      </View>

      <View style={{ height: 8, borderRadius: 4, backgroundColor: t.chip, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
        <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, pct * 100)}%`, backgroundColor: look.color }} />
      </View>

      <Text style={{ color: t.text, fontWeight: '700', fontSize: 14 }}>{headline}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        {`${mask(hidden, Math.max(0, plan.safe_to_spend_cents))} free over ${plan.days_left} day${plan.days_left === 1 ? '' : 's'} until ${until}`}
        {plan.bills_before_payday.length ? ` · ${mask(hidden, plan.bills_before_payday_cents)} kept for ${plan.bills_before_payday.length} bill${plan.bills_before_payday.length === 1 ? '' : 's'}` : ''}
        {d.bills_paid_cents > 0 ? ` · bills paid today not counted` : ''}
      </Text>
      {plan.budget_mode === 'fixed' && !plan.budget_fits && d.status !== 'short' && (
        <Text style={{ color: t.gold, fontSize: 12 }}>
          Your set budget would dip into bill money before payday. Automatic: {mask(hidden, plan.auto_daily_budget_cents)}/day.
        </Text>
      )}
    </Card>
  );
}

/** Slim split bar: bills by priority, then savings, then free spending. */
function SplitBar({ payroll, height = 10 }) {
  const t = useTheme();
  const total = Math.max(payroll.pay_cents, payroll.bills_cents, 1);
  // Same priority colours as the website (checked for colour-blind separation)
  const shades = PRIORITY_COLOR;
  const parts = [
    ...payroll.groups.map((g) => ({ key: g.key, value: g.total_cents, color: shades[g.key] })),
    { key: 'save', value: payroll.suggested_save_cents, color: t.accent },
    { key: 'free', value: Math.max(0, payroll.free_cents - payroll.suggested_save_cents), color: t.chip },
  ].filter((p) => p.value > 0);
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: t.chip, gap: 2 }}>
      {parts.map((p) => <View key={p.key} style={{ flex: p.value / total, backgroundColor: p.color }} />)}
    </View>
  );
}

/** Home: one-glance preview of the next payroll. */
export function PaydayPreview({ plan, hidden, onPress }) {
  const t = useTheme();
  const p = plan.payroll;
  if (!p) return null;
  const when = p.days_away === 1 ? 'tomorrow' : `in ${p.days_away} days`;
  return (
    <Card onPress={onPress} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontWeight: '800', fontSize: 16, color: t.text }}>Next payday <Text style={{ color: t.muted, fontWeight: '500', fontSize: 13 }}>· {when}</Text></Text>
        <Text style={{ color: t.muted, fontWeight: '600', fontSize: 13 }}>Plan ›</Text>
      </View>
      <SplitBar payroll={p} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Mini label="Pay" value={mask(hidden, p.pay_cents)} />
        <Mini label="Bills" value={mask(hidden, p.bills_cents)} />
        {p.shortfall_cents > 0
          ? <Mini label="Short" value={mask(hidden, p.shortfall_cents)} color={t.danger} />
          : <Mini label="Save" value={mask(hidden, p.suggested_save_cents)} color={t.accent} />}
        <Mini label="Per day" value={mask(hidden, p.suggested_daily_cents)} />
      </View>
    </Card>
  );
}

function Mini({ label, value, color }) {
  const t = useTheme();
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: t.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: color ?? t.text, fontWeight: '700', fontSize: 13, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Plan tab: what the next payroll should cover, in the order to pay. */
export function PayrollPlanCard({ plan }) {
  const t = useTheme();
  const p = plan.payroll;
  if (!p) {
    return (
      <Card>
        <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>Next payroll</Text>
        <Text style={{ color: t.muted }}>Add your salary below to see what each payroll should cover.</Text>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <View>
        <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>Next payroll · {friendlyDate(p.date)}</Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>Covers bills until {friendlyDate(p.until)} ({p.cycle_days} days)</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: t.muted }}>Expected pay</Text>
        <Money cents={p.pay_cents} kind="income" size={18} weight="800" />
      </View>
      <SplitBar payroll={p} />

      {p.groups.map((g) => (
        <View key={g.key} style={{ gap: 2, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name={PRIORITY_ICON[g.key]} size={14} color={PRIORITY_COLOR[g.key]} />
            <Text style={{ flex: 1, color: t.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{g.rank}. {g.label}</Text>
            <Text style={{ color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{formatPHP(g.total_cents)}</Text>
          </View>
          {g.items.map((b) => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3, opacity: b.covered ? 1 : 0.6 }}>
              <Ionicons name={b.covered ? 'checkmark-circle-outline' : 'close-circle-outline'} size={16} color={b.covered ? t.income : t.danger} />
              <Text style={{ flex: 1, color: t.text, fontSize: 14 }} numberOfLines={1}>{b.name} <Text style={{ color: t.muted, fontSize: 12 }}>· {friendlyDate(b.date)}</Text></Text>
              <Money cents={b.amount_cents} size={14} />
            </View>
          ))}
        </View>
      ))}
      {p.bills.length === 0 && <Text style={{ color: t.muted }}>No bills due in this pay period.</Text>}

      <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingTop: 10, gap: 6 }}>
        {p.shortfall_cents > 0 ? (
          <>
            <Text style={{ color: t.danger, fontWeight: '800' }}>Short by {formatPHP(p.shortfall_cents)}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              Pay loans and rent/utilities first.{p.can_defer.length ? ` Consider pausing or moving: ${p.can_defer.map((b) => b.name).join(', ')}.` : ''}
            </Text>
          </>
        ) : (
          <>
            <Suggestion icon="wallet-outline" label="Left after bills" cents={p.free_cents} />
            <Suggestion icon="leaf-outline" label={`Put into savings (${p.save_rate_pct}%)`} cents={p.suggested_save_cents} color={t.accent} />
            <Suggestion icon="cafe-outline" label={`Spend per day for ${p.cycle_days} days`} cents={p.suggested_daily_cents} />
          </>
        )}
      </View>
    </Card>
  );
}

function Suggestion({ icon, label, cents, color }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} size={16} color={color ?? t.muted} />
      <Text style={{ flex: 1, color: t.text }}>{label}</Text>
      <Money cents={cents} size={15} weight="700" style={color ? { color } : null} />
    </View>
  );
}
