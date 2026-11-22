// "Set up my finances" guide: enter everything you have today in a few minutes.
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { toCents, todayInManila, formatPHP } from '@ft/shared';
import { RequireAuth } from '../components/RequireAuth';
import { useAuth } from '../lib/auth';
import { Body, Button, Card, Chip, ErrorText, Field, IconButton, Label, Money, Segmented, Title } from '../components/ui';
import { BigAmount } from '../components/BigAmount';
import { useAccounts, useRecurring, useSummary, refreshMoney, api } from '../lib/queries';
import { queryClient } from '../lib/queryClient';
import { loanProgress } from '../lib/loans';
import { FREQUENCY_LABELS } from '../lib/format';
import { useTheme, space, radius } from '../theme';


const STEPS = ['Money you have', 'Credit cards', 'Loans you’re paying', 'Utang', 'Salary & bills', 'Done'];
const MONEY_PRESETS = [
  ['BDO', 'bank'], ['BPI', 'bank'], ['Metrobank', 'bank'], ['UnionBank', 'bank'], ['Landbank', 'bank'], ['Security Bank', 'bank'],
  ['GCash', 'digital_bank'], ['Maya', 'digital_bank'], ['GoTyme', 'digital_bank'], ['MariBank', 'digital_bank'], ['SeaBank', 'digital_bank'], ['CIMB', 'digital_bank'],
  ['Cash on hand', 'cash'], ['Savings', 'savings'],
];
const CARD_PRESETS = ['BDO Credit Card', 'BPI Credit Card', 'Metrobank Credit Card', 'Security Bank Credit Card', 'RCBC Credit Card', 'UnionBank Credit Card'];
const BILL_PRESETS = ['Rent', 'Meralco', 'Water', 'Internet', 'Phone / Load', 'Netflix', 'Spotify', 'Insurance', 'Tuition'];
const MONEY_TYPES = [['bank', 'Bank'], ['digital_bank', 'E-wallet / digital'], ['cash', 'Cash'], ['savings', 'Savings']];

const clean = (v) => v.replace(/[^0-9.,]/g, '');
let rowKey = 0;
const newRow = (fields) => ({ key: ++rowKey, ...fields });

/** Next date that falls on `day` of the month (today counts). */
function nextDateForDay(day) {
  const today = todayInManila();
  const [y, m, d] = today.split('-').map(Number);
  const make = (yy, mm) => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  };
  if (day >= d) return make(y, m);
  return m === 12 ? make(y + 1, 1) : make(y, m + 1);
}

export default function Setup() {
  return (
    <RequireAuth>
      <SetupGuide />
    </RequireAuth>
  );
}

function SetupGuide() {
  const t = useTheme();
  const router = useRouter();
  const { setOnboarded } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const accounts = useAccounts().data ?? [];
  const recurring = useRecurring().data ?? [];

  // Rows typed in on each step (saved on Next)
  const [money, setMoney] = useState([]);
  const [cards, setCards] = useState([]);
  const [people, setPeople] = useState([]);
  const [salary, setSalary] = useState({ amount: '', frequency: 'semi_monthly', day: '15' });
  const [bills, setBills] = useState([]);

  const update = (setter) => (key, patch) => setter((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (setter) => (key) => setter((rows) => rows.filter((r) => r.key !== key));

  async function saveStep() {
    if (step === 0) {
      for (const r of money) {
        if (!r.name.trim()) continue;
        await api.post('/accounts', { name: r.name.trim(), type: r.type, opening_balance_cents: toCents(r.balance || '0') ?? 0 });
      }
      setMoney([]);
    } else if (step === 1) {
      for (const r of cards) {
        if (!r.name.trim()) continue;
        await api.post('/accounts', { name: r.name.trim(), type: 'credit_card', opening_balance_cents: -Math.abs(toCents(r.owed || '0') ?? 0) });
      }
      setCards([]);
    } else if (step === 3) {
      for (const r of people) {
        const cents = Math.abs(toCents(r.amount || '0') ?? 0);
        if (!r.name.trim()) continue;
        await api.post('/accounts', { name: r.name.trim(), type: 'person', opening_balance_cents: r.direction === 'i_owe' ? -cents : cents });
      }
      setPeople([]);
    } else if (step === 4) {
      const pay = toCents(salary.amount || '0') ?? 0;
      if (pay > 0) {
        const day = Math.min(31, Math.max(1, Number.parseInt(salary.day, 10) || 15));
        await api.post('/recurring', { kind: 'income', name: 'Salary', amount_cents: pay, frequency: salary.frequency, next_date: nextDateForDay(day) });
        setSalary({ amount: '', frequency: 'semi_monthly', day: '15' });
      }
      for (const r of bills) {
        const cents = toCents(r.amount || '0') ?? 0;
        if (!r.name.trim() || !cents) continue;
        const day = Math.min(31, Math.max(1, Number.parseInt(r.day, 10) || 1));
        await api.post('/recurring', { kind: 'expense', name: r.name.trim(), amount_cents: cents, frequency: 'monthly', next_date: nextDateForDay(day) });
      }
      setBills([]);
    }
  }

  async function next() {
    setError(null);
    setBusy(true);
    try {
      await saveStep();
      await refreshMoney();
      await queryClient.invalidateQueries({ queryKey: ['recurring'] });
      if (step === STEPS.length - 2) await setOnboarded(true);
      setStep((s) => s + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const existingMoney = accounts.filter((a) => !['person', 'credit_card'].includes(a.type));
  const existingCards = accounts.filter((a) => a.type === 'credit_card' && !a.loan_months);
  const existingLoans = accounts.filter((a) => a.type === 'credit_card' && a.loan_months);
  const existingPeople = accounts.filter((a) => a.type === 'person');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Progress */}
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: space.lg, paddingTop: space.md }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.primary : t.chip }} />
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Body muted style={{ fontSize: 12 }}>Step {step + 1} of {STEPS.length}</Body>
        <Title>{STEPS[step]}</Title>

        {step === 0 && (
          <>
            <Body muted>Every bank, e-wallet and cash you have, with today's balance. Check your apps for the exact amounts. Close is fine too; you can adjust later.</Body>
            <Already items={existingMoney} />
            <PresetChips presets={MONEY_PRESETS.map(([n]) => n)} taken={[...existingMoney, ...money].map((a) => a.name)} onPick={(name) => {
              const type = MONEY_PRESETS.find(([n]) => n === name)?.[1] ?? 'bank';
              setMoney((rows) => [...rows, newRow({ name, type, balance: '' })]);
            }} />
            {money.map((r) => (
              <RowCard key={r.key} onRemove={() => remove(setMoney)(r.key)}>
                <Field value={r.name} onChangeText={(v) => update(setMoney)(r.key, { name: v })} placeholder="Name" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {MONEY_TYPES.map(([v, l]) => <Chip key={v} label={l} selected={r.type === v} onPress={() => update(setMoney)(r.key, { type: v })} />)}
                </View>
                <Field value={r.balance} onChangeText={(v) => update(setMoney)(r.key, { balance: clean(v) })} placeholder="Balance today ₱" keyboardType="decimal-pad" />
              </RowCard>
            ))}
            <Button title="Add another" variant="secondary" icon="add" onPress={() => setMoney((rows) => [...rows, newRow({ name: '', type: 'bank', balance: '' })])} />
          </>
        )}

        {step === 1 && (
          <>
            <Body muted>Any credit cards, and how much you owe on each right now (the current balance, not the minimum due). Skip if you have none.</Body>
            <Already items={existingCards} />
            <PresetChips presets={CARD_PRESETS} taken={[...existingCards, ...cards].map((a) => a.name)} onPick={(name) => setCards((rows) => [...rows, newRow({ name, owed: '' })])} />
            {cards.map((r) => (
              <RowCard key={r.key} onRemove={() => remove(setCards)(r.key)}>
                <Field value={r.name} onChangeText={(v) => update(setCards)(r.key, { name: v })} placeholder="Card name" />
                <Field value={r.owed} onChangeText={(v) => update(setCards)(r.key, { owed: clean(v) })} placeholder="Amount owed ₱" keyboardType="decimal-pad" />
              </RowCard>
            ))}
            <Button title="Add a card" variant="secondary" icon="add" onPress={() => setCards((rows) => [...rows, newRow({ name: '', owed: '' })])} />
          </>
        )}

        {step === 2 && (
          <>
            <Body muted>
              Loans or pay-later you're still paying (BillEase, SPayLater, GGives, Home Credit, a bank loan…). You don't need to remember what it was for, just what's left. Check the lender's app for the remaining balance.
            </Body>
            {existingLoans.map((a) => {
              const p = loanProgress(a);
              return (
                <Card key={a.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: '700' }}>{a.name}</Body>
                    {p && <Body muted style={{ fontSize: 13 }}>{p.remainingPayments} payments left · {formatPHP(a.loan_installment_cents)}/mo</Body>}
                  </View>
                  <Money cents={a.balance_cents} />
                </Card>
              );
            })}
            <Button title="Add a loan I'm paying" icon="add" onPress={() => router.push('/loan/new?kind=existing&back=1')} />
          </>
        )}

        {step === 3 && (
          <>
            <Body muted>People who owe you money, and people you owe. Skip if none.</Body>
            <Already items={existingPeople} people />
            {people.map((r) => (
              <RowCard key={r.key} onRemove={() => remove(setPeople)(r.key)}>
                <Field value={r.name} onChangeText={(v) => update(setPeople)(r.key, { name: v })} placeholder="Name, e.g. Juan" />
                <Segmented value={r.direction} onChange={(v) => update(setPeople)(r.key, { direction: v })} options={[{ value: 'owes_me', label: 'Owes me' }, { value: 'i_owe', label: 'I owe' }]} />
                <Field value={r.amount} onChangeText={(v) => update(setPeople)(r.key, { amount: clean(v) })} placeholder="Amount ₱" keyboardType="decimal-pad" />
              </RowCard>
            ))}
            <Button title="Add a person" variant="secondary" icon="person-add-outline" onPress={() => setPeople((rows) => [...rows, newRow({ name: '', direction: 'owes_me', amount: '' })])} />
          </>
        )}

        {step === 4 && (
          <>
            <Body muted>Your pay and regular bills. You'll see what you can save each month, and get reminders if you turn them on.</Body>
            {recurring.length > 0 && (
              <Card>
                <Label>Already added</Label>
                {recurring.map((r) => (
                  <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Body>{r.name}</Body>
                    <Money cents={r.amount_cents} kind={r.kind} />
                  </View>
                ))}
              </Card>
            )}
            <Card>
              <Label>Salary</Label>
              <Field value={salary.amount} onChangeText={(v) => setSalary((s) => ({ ...s, amount: clean(v) }))} placeholder="Amount each payday ₱ (leave empty to skip)" keyboardType="decimal-pad" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {['semi_monthly', 'monthly', 'weekly', 'fortnightly'].map((f) => (
                  <Chip key={f} label={FREQUENCY_LABELS[f]} selected={salary.frequency === f} onPress={() => setSalary((s) => ({ ...s, frequency: f }))} />
                ))}
              </View>
              <Field value={salary.day} onChangeText={(v) => setSalary((s) => ({ ...s, day: v.replace(/\D/g, '') }))} placeholder="Next payday (day of month, e.g. 15)" keyboardType="number-pad" />
              {salary.frequency === 'semi_monthly' && <Body muted style={{ fontSize: 12 }}>Twice a month: e.g. 15 means the 15th and the 30th.</Body>}
            </Card>
            <Label>Bills</Label>
            <PresetChips presets={BILL_PRESETS} taken={[...recurring, ...bills].map((b) => b.name)} onPick={(name) => setBills((rows) => [...rows, newRow({ name, amount: '', day: '' })])} />
            {bills.map((r) => (
              <RowCard key={r.key} onRemove={() => remove(setBills)(r.key)}>
                <Field value={r.name} onChangeText={(v) => update(setBills)(r.key, { name: v })} placeholder="Bill name" />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <View style={{ flex: 2 }}><Field value={r.amount} onChangeText={(v) => update(setBills)(r.key, { amount: clean(v) })} placeholder="Monthly ₱" keyboardType="decimal-pad" /></View>
                  <View style={{ flex: 1 }}><Field value={r.day} onChangeText={(v) => update(setBills)(r.key, { day: v.replace(/\D/g, '') })} placeholder="Due day" keyboardType="number-pad" /></View>
                </View>
              </RowCard>
            ))}
            <Button title="Add another bill" variant="secondary" icon="add" onPress={() => setBills((rows) => [...rows, newRow({ name: '', amount: '', day: '' })])} />
          </>
        )}

        {step === 5 && <Finished />}

        <ErrorText error={error} />
      </ScrollView>

      {/* Footer */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: 28, backgroundColor: t.bg, flexDirection: 'row', gap: space.sm, borderTopWidth: 1, borderTopColor: t.border }}>
        {step === 0 && (
          <Button
            title="Skip for now"
            variant="secondary"
            onPress={async () => { await setOnboarded(true).catch(() => {}); router.replace('/'); }}
            style={{ flex: 1 }}
          />
        )}
        {step > 0 && step < STEPS.length - 1 && (
          <Button title="Back" variant="secondary" onPress={() => setStep((s) => s - 1)} style={{ flex: 1 }} />
        )}
        {step < STEPS.length - 1 ? (
          <Button title={step === STEPS.length - 2 ? 'Finish' : 'Next'} onPress={next} loading={busy} style={{ flex: 2 }} />
        ) : (
          <Button title="Go to Home" onPress={() => router.replace('/')} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

function Finished() {
  const t = useTheme();
  const s = useSummary().data;
  if (!s) return null;
  const b = s.balances;
  return (
    <>
      <Card style={{ alignItems: 'center', gap: 6, backgroundColor: t.hero }}>
        <Text style={{ color: t.heroText, opacity: 0.6, fontWeight: '700' }}>Your starting net worth</Text>
        <BigAmount cents={b.net_worth_cents} size={44} color={t.heroText} />
      </Card>
      <Card>
        <Line label="Money you have" cents={b.assets_cents - b.owed_to_you_cents} />
        {b.owed_to_you_cents > 0 && <Line label="Owed to you" cents={b.owed_to_you_cents} />}
        <Line label="Credit cards & loans" cents={b.by_type.credit_card} />
        {b.you_owe_cents < 0 && <Line label="You owe people" cents={b.you_owe_cents} />}
        <Line label="Monthly income (estimate)" cents={s.recurring.monthly_income_cents} />
        <Line label="Monthly bills (estimate)" cents={-s.recurring.monthly_expenses_cents} />
      </Card>
      <Body muted>
        From now on, log what you spend and receive (double-tap anywhere, or the Expense / Income buttons). Turn on payment detection and reminders in Settings → Smart features to make it easier.
      </Body>
    </>
  );
}

function Line({ label, cents }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
      <Body>{label}</Body>
      <Money cents={cents} />
    </View>
  );
}

function Already({ items, people }) {
  if (!items.length) return null;
  return (
    <Card>
      <Label>Already added</Label>
      {items.map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Body>{a.name}</Body>
          {people
            ? <Money cents={Math.abs(a.balance_cents)} kind={a.balance_cents > 0 ? 'income' : a.balance_cents < 0 ? 'expense' : undefined} />
            : <Money cents={a.balance_cents} />}
        </View>
      ))}
    </Card>
  );
}

function PresetChips({ presets, taken, onPick }) {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  const left = presets.filter((p) => !lower.has(p.toLowerCase()));
  if (!left.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {left.map((p) => <Chip key={p} icon="add" label={p} onPress={() => onPick(p)} />)}
    </View>
  );
}

function RowCard({ children, onRemove }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.card, borderRadius: radius.lg, padding: space.md, gap: space.sm }}>
      <View style={{ position: 'absolute', right: 6, top: 6, zIndex: 1 }}>
        <IconButton icon="close" label="Remove" color={t.muted} onPress={onRemove} />
      </View>
      <View style={{ gap: space.sm, paddingRight: 36 }}>{children}</View>
    </View>
  );
}
