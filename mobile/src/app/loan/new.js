// Loan / buy-now-pay-later setup (BillEase, SPayLater, GGives…).
import { useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { toCents, todayInManila, addDays, formatPHP } from '@ft/shared';
import { RequireAuth } from '../../components/RequireAuth';
import { Body, Button, Card, Chip, ChipRow, ErrorText, Field, Label, Segmented, ToggleRow } from '../../components/ui';
import { useAccounts, useCategories, useMoneyMutation, api } from '../../lib/queries';
import { LENDER_CHOICES } from '../../lib/loans';
import { centsToInput, friendlyDate } from '../../lib/format';
import { space } from '../../theme';

const MONTH_CHOICES = [3, 6, 9, 12, 24];
const clean = (v) => v.replace(/[^0-9.,]/g, '');

export default function NewLoan() {
  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <LoanForm />
      </ScrollView>
    </RequireAuth>
  );
}

function LoanForm() {
  const router = useRouter();
  // /loan/new?kind=existing&back=1 (from the setup guide: come back to it afterwards)
  const params = useLocalSearchParams();
  const accounts = (useAccounts().data ?? []).filter((a) => a.type !== 'person' && a.type !== 'credit_card' && !a.archived);
  const categories = (useCategories().data ?? []).filter((c) => c.kind === 'expense' && !c.archived && !c.is_system);

  const [lender, setLender] = useState('BillEase');
  const [otherLender, setOtherLender] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState(['purchase', 'cash', 'existing'].includes(params.kind) ? params.kind : 'purchase');
  const [principal, setPrincipal] = useState('');
  const [remaining, setRemaining] = useState('');
  const [total, setTotal] = useState('');
  const [months, setMonths] = useState(6);
  const [monthsText, setMonthsText] = useState('');
  const [installment, setInstallment] = useState('');
  const [firstDue, setFirstDue] = useState(addDays(todayInManila(), 30));
  const [picker, setPicker] = useState(false);
  const [categoryId, setCategoryId] = useState(null);
  const [toAccountId, setToAccountId] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState(null);

  const existing = kind === 'existing';
  const remainingCents = toCents(remaining || '0') ?? 0;
  const principalCents = existing ? remainingCents : toCents(principal || '0') ?? 0;
  const totalCents = existing ? remainingCents : toCents(total || principal || '0') ?? 0;
  const monthCount = monthsText ? Number.parseInt(monthsText, 10) || 0 : months;
  const autoInstallment = monthCount > 0 ? Math.ceil(totalCents / monthCount) : 0;
  const installmentCents = installment ? toCents(installment) ?? 0 : autoInstallment;
  const interest = Math.max(0, totalCents - principalCents);
  const rate = principalCents ? (interest / principalCents) * 100 : 0;

  const create = useMoneyMutation((body) => api.post('/loans', body), { extraKeys: ['recurring'] });
  const lenderName = lender === 'Other' ? otherLender.trim() : lender;

  const preview = useMemo(() => {
    if (!principalCents || !monthCount) return null;
    if (existing) return `${monthCount} payments of ${formatPHP(installmentCents)} left · ${formatPHP(remainingCents)} owed`;
    return `${monthCount} payments of ${formatPHP(installmentCents)} · interest & fees ${formatPHP(interest)}${interest ? ` (${rate.toFixed(1)}%)` : ''}`;
  }, [principalCents, monthCount, installmentCents, interest, rate, existing, remainingCents]);

  async function onSave() {
    setError(null);
    if (!lenderName) return setError({ message: 'Enter the lender name' });
    if (!principalCents) return setError({ message: existing ? 'Enter how much you still owe' : kind === 'purchase' ? 'Enter the price' : 'Enter how much you received' });
    if (totalCents < principalCents) return setError({ message: 'Total to pay back can’t be less than what you borrowed' });
    if (!monthCount || monthCount > 120) return setError({ message: 'Enter the number of months (1–120)' });
    if (kind === 'cash' && !toAccountId) return setError({ message: 'Choose where the cash went' });
    try {
      const { account } = await create.mutateAsync({
        lender: lenderName,
        label: label.trim() || undefined,
        kind,
        ...(existing
          ? { remaining_cents: remainingCents }
          : { principal_cents: principalCents, total_payable_cents: totalCents }),
        months: monthCount,
        installment_cents: installmentCents || undefined,
        first_due_date: firstDue,
        category_id: kind === 'purchase' ? categoryId : undefined,
        to_account_id: kind === 'cash' ? toAccountId : undefined,
        is_private: isPrivate,
      });
      if (params.back) router.back();
      else router.replace(`/account/${account.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <View style={{ gap: space.sm }}>
        <Label>Lender</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {[...LENDER_CHOICES, 'Other'].map((l) => <Chip key={l} label={l} selected={lender === l} onPress={() => setLender(l)} />)}
        </View>
        {lender === 'Other' && <Field value={otherLender} onChangeText={setOtherLender} placeholder="Lender name" maxLength={40} />}
      </View>

      <Segmented value={kind} onChange={setKind} options={[{ value: 'purchase', label: 'New purchase' }, { value: 'cash', label: 'Cash loan' }, { value: 'existing', label: 'Already paying' }]} />
      {existing && (
        <Body muted style={{ fontSize: 13 }}>
          For a loan you're already paying, even if you don't remember what it was for. You just need what's left to pay. It won't count as this month's spending.
        </Body>
      )}

      {kind !== 'cash' && (
        <Field label={existing ? 'Label (optional)' : 'What did you buy? (optional)'} value={label} onChangeText={setLabel} placeholder="e.g. Phone, Ref, Laptop" maxLength={40} />
      )}
      {existing ? (
        <Field label="How much you still owe" value={remaining} onChangeText={(v) => setRemaining(clean(v))} placeholder="₱0.00 (check the lender app)" keyboardType="decimal-pad" />
      ) : (<>
      <Field
        label={kind === 'purchase' ? 'Price' : 'Amount you received'}
        value={principal}
        onChangeText={(v) => setPrincipal(clean(v))}
        placeholder="₱0.00"
        keyboardType="decimal-pad"
      />
      <Field
        label="Total you'll pay back (incl. interest & fees)"
        value={total}
        onChangeText={(v) => setTotal(clean(v))}
        placeholder={principal ? `₱${principal} if no interest` : '₱0.00'}
        keyboardType="decimal-pad"
      />
      </>)}

      <View style={{ gap: space.sm }}>
        <Label>{existing ? 'Payments left' : 'Number of months'}</Label>
        <ChipRow>
          {MONTH_CHOICES.map((m) => (
            <Chip key={m} label={`${m}`} selected={!monthsText && months === m} onPress={() => { setMonths(m); setMonthsText(''); }} />
          ))}
        </ChipRow>
        <Field value={monthsText} onChangeText={(v) => setMonthsText(v.replace(/\D/g, ''))} placeholder="Other (e.g. 18)" keyboardType="number-pad" />
      </View>

      <Field
        label="Monthly payment"
        value={installment}
        onChangeText={(v) => setInstallment(clean(v))}
        placeholder={autoInstallment ? `${centsToInput(autoInstallment)} (total ÷ months)` : '₱0.00'}
        keyboardType="decimal-pad"
      />

      <View style={{ gap: space.sm }}>
        <Label>{existing ? 'Next payment due' : 'First payment due'}</Label>
        <ChipRow>
          <Chip icon="calendar-outline" label={friendlyDate(firstDue)} selected onPress={() => setPicker(true)} />
        </ChipRow>
        {picker && (
          <DateTimePicker
            value={new Date(`${firstDue}T12:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              setPicker(Platform.OS === 'ios');
              if (event.type === 'set' && picked) {
                setFirstDue(`${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`);
              }
            }}
          />
        )}
      </View>

      {existing ? null : kind === 'purchase' ? (
        <View style={{ gap: space.sm }}>
          <Label>Category (optional)</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {categories.map((c) => <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />)}
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Label>Cash went to</Label>
          <ChipRow>
            {accounts.map((a) => <Chip key={a.id} label={a.name} selected={toAccountId === a.id} onPress={() => setToAccountId(a.id)} />)}
          </ChipRow>
        </View>
      )}

      <ToggleRow label="Private" hint="Hide this loan from your partner" value={isPrivate} onValueChange={setIsPrivate} />

      {preview && (
        <Card>
          <Body style={{ fontWeight: '700' }}>{preview}</Body>
          <Body muted style={{ fontSize: 13 }}>
            {existing
              ? `This adds a ${lenderName || 'loan'} account owing ${formatPHP(totalCents)} and reminds you`
              : `This adds a ${lenderName || 'loan'} account owing ${formatPHP(totalCents)}, records the ${kind === 'purchase' ? 'purchase' : 'cash'} and the interest, and reminds you`} the evening before each payment. Each payment is then a transfer into it (e.g. GCash → {lenderName || 'loan'}).
          </Body>
        </Card>
      )}

      <ErrorText error={error} />
      <Button title="Set up loan" onPress={onSave} loading={create.isPending} />
    </>
  );
}
