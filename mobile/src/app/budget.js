// Budget settings: automatic or fixed daily budget, and how much of each payroll to save.
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { toCents } from '@ft/shared';
import { RequireAuth } from '../components/RequireAuth';
import { Button, Card, Chip, ErrorText, Field, Label, Segmented } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useHousehold, useSummary, api } from '../lib/queries';
import { queryClient } from '../lib/queryClient';
import { centsToInput, formatPHP } from '../lib/format';
import { useTheme, space } from '../theme';

const SAVE_OPTIONS = [0, 10, 15, 20, 25, 30, 40, 50];

export default function BudgetScreen() {
  const t = useTheme();
  const { isOwner } = useAuth();
  const household = useHousehold();
  const summary = useSummary();
  const h = household.data?.household;
  const plan = summary.data?.plan;

  const [mode, setMode] = useState('auto');
  const [amount, setAmount] = useState('');
  const [save, setSave] = useState(20);
  const [saved, setSaved] = useState(false);

  // Start from what's saved on the server
  useEffect(() => {
    if (!h) return;
    setMode(h.daily_budget_cents ? 'fixed' : 'auto');
    setAmount(h.daily_budget_cents ? centsToInput(Number(h.daily_budget_cents)) : '');
    setSave(h.save_rate_pct ?? 20);
  }, [h?.daily_budget_cents, h?.save_rate_pct]);

  const cents = toCents(amount || 'x');
  const valid = mode === 'auto' || (cents !== null && cents > 0);
  const update = useMutation({
    mutationFn: () => api.patch('/household', { daily_budget_cents: mode === 'fixed' ? cents : null, save_rate_pct: save }),
    onSuccess: async () => {
      setSaved(true);
      await Promise.all(['household', 'summary'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
  });
  const change = (fn) => (v) => { setSaved(false); fn(v); };

  const days = plan?.days_left ?? 0;
  const tooHigh = mode === 'fixed' && cents && plan && cents * days > Math.max(0, plan.safe_to_spend_cents);

  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space.md }}>
          <Label>Daily budget</Label>
          <Segmented
            value={mode}
            onChange={isOwner ? change(setMode) : () => {}}
            options={[{ value: 'auto', label: 'Automatic' }, { value: 'fixed', label: 'Set my own' }]}
          />
          {mode === 'auto' ? (
            <Text style={{ color: t.muted, lineHeight: 20 }}>
              Your money on hand, minus bills due before payday, spread over the days until payday.
              {plan ? ` Right now that's ${formatPHP(plan.auto_daily_budget_cents)} a day.` : ''}
            </Text>
          ) : (
            <>
              <Field
                value={amount}
                onChangeText={change((v) => setAmount(v.replace(/[^0-9.,]/g, '')))}
                placeholder="₱ per day, e.g. 500"
                keyboardType="decimal-pad"
                editable={isOwner}
              />
              {plan && (
                <Text style={{ color: tooHigh ? t.danger : t.muted, lineHeight: 20 }}>
                  {tooHigh
                    ? `That's more than you can afford until payday. Automatic would give ${formatPHP(plan.auto_daily_budget_cents)} a day without touching bill money.`
                    : `Automatic would give ${formatPHP(plan.auto_daily_budget_cents)} a day.`}
                </Text>
              )}
            </>
          )}
        </Card>

        <Card style={{ gap: space.md }}>
          <Label>Save from each payroll</Label>
          <Text style={{ color: t.muted, lineHeight: 20 }}>The share of what's left after bills that the payroll plan suggests putting into savings.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {SAVE_OPTIONS.map((p) => (
              <Chip key={p} label={`${p}%`} selected={save === p} onPress={isOwner ? () => change(setSave)(p) : undefined} />
            ))}
          </View>
        </Card>

        {isOwner ? (
          <>
            <ErrorText error={update.error} />
            <Button title={saved ? 'Saved' : 'Save'} icon={saved ? 'checkmark' : undefined} loading={update.isPending} disabled={!valid || !h} onPress={() => update.mutate()} />
          </>
        ) : (
          <Text style={{ color: t.muted, textAlign: 'center' }}>Only the wallet owner can change these.</Text>
        )}
      </ScrollView>
    </RequireAuth>
  );
}
