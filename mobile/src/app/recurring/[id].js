import { useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FREQUENCIES, toCents, todayInManila } from '@ft/shared';
import { RequireAuth } from '../../components/RequireAuth';
import { Body, Button, Chip, ChipRow, ErrorText, Field, Label, Loading, Segmented, ToggleRow } from '../../components/ui';
import { useAccounts, useCategories, useMoneyMutation, useRecurring, api } from '../../lib/queries';
import { FREQUENCY_LABELS, centsToInput, friendlyDate } from '../../lib/format';
import { useTheme, space } from '../../theme';

// /recurring/new?kind=income  -> create
// /recurring/<id>             -> edit
export default function RecurringScreen() {
  const { id, kind } = useLocalSearchParams();
  const isNew = id === 'new';
  const q = useRecurring();
  const item = isNew ? null : q.data?.find((i) => i.id === id);

  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {!isNew && q.isPending && <Loading />}
        <ErrorText error={q.error} />
        {!isNew && q.data && !item && <Body muted>This item no longer exists.</Body>}
        {(isNew || item) && <RecurringForm key={item?.id ?? 'new'} item={item} defaultKind={kind === 'income' ? 'income' : 'expense'} />}
      </ScrollView>
    </RequireAuth>
  );
}

function RecurringForm({ item, defaultKind }) {
  const t = useTheme();
  const router = useRouter();
  const isNew = !item;
  const readOnly = !isNew && !item.can_edit;
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived);
  const allCategories = useCategories().data ?? [];

  const [kind, setKind] = useState(item?.kind ?? defaultKind);
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(centsToInput(item?.amount_cents));
  const [frequency, setFrequency] = useState(item?.frequency ?? 'monthly');
  const [accountId, setAccountId] = useState(item?.account_id ?? null);
  const [categoryId, setCategoryId] = useState(item?.category_id ?? null);
  const [nextDate, setNextDate] = useState(item?.next_date ?? null);
  const [active, setActive] = useState(item?.active ?? true);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState(null);

  const save = useMoneyMutation((body) => (isNew ? api.post('/recurring', body) : api.patch(`/recurring/${item.id}`, body)));
  const remove = useMoneyMutation(() => api.del(`/recurring/${item.id}`));
  const categories = allCategories.filter((c) => c.kind === kind && !c.archived && !c.is_system);

  async function onSave() {
    setError(null);
    const cents = toCents(amount || '0');
    if (!name.trim()) return setError({ message: 'Give it a name, e.g. Salary or Rent' });
    if (!cents || cents <= 0) return setError({ message: 'Enter an amount' });
    const body = {
      kind,
      name: name.trim(),
      amount_cents: cents,
      frequency,
      account_id: accountId,
      category_id: categoryId,
      next_date: nextDate,
      active,
    };
    try {
      await save.mutateAsync(body);
      router.back();
    } catch (err) {
      setError(err);
    }
  }

  function onDelete() {
    Alert.alert(`Delete ${item.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await remove.mutateAsync(); router.back(); } catch (err) { setError(err); }
      } },
    ]);
  }

  if (readOnly) {
    return <Body muted>{item.name}: {FREQUENCY_LABELS[item.frequency].toLowerCase()}. Only the wallet owner can change income and bills.</Body>;
  }

  return (
    <>
      <Segmented
        value={kind}
        onChange={(v) => { setKind(v); setCategoryId(null); }}
        options={[{ value: 'income', label: 'Income', color: t.income }, { value: 'expense', label: 'Bill / expense', color: t.expense }]}
      />
      <Field label="Name" value={name} onChangeText={setName} placeholder={kind === 'income' ? 'e.g. Salary' : 'e.g. Rent, Meralco, Netflix'} maxLength={60} />
      <Field label="Amount each time" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))} placeholder="₱0.00" keyboardType="decimal-pad" />

      <View style={{ gap: space.sm }}>
        <Label>How often</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {FREQUENCIES.map((f) => <Chip key={f} label={FREQUENCY_LABELS[f]} selected={frequency === f} onPress={() => setFrequency(f)} />)}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>Next date</Label>
        <ChipRow>
          <Chip icon="calendar-outline" label={nextDate ? friendlyDate(nextDate) : 'Pick date'} selected={!!nextDate} onPress={() => setPicker(true)} />
          {nextDate && <Chip label="No date" onPress={() => setNextDate(null)} />}
        </ChipRow>
        {picker && (
          <DateTimePicker
            value={new Date(`${nextDate ?? todayInManila()}T12:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              setPicker(Platform.OS === 'ios');
              if (event.type === 'set' && picked) {
                setNextDate(`${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`);
              }
            }}
          />
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <Label>{kind === 'income' ? 'Paid into' : 'Paid from'} (optional)</Label>
        <ChipRow>
          {accounts.map((a) => (
            <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(accountId === a.id ? null : a.id)} />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>Category (optional)</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? null : c.id)} />
          ))}
        </View>
      </View>

      <ToggleRow label="Active" hint="Paused items don't count toward monthly totals" value={active} onValueChange={setActive} />

      <ErrorText error={error} />
      <Button title={isNew ? 'Add' : 'Save changes'} onPress={onSave} loading={save.isPending} />
      {!isNew && <Button title="Delete" variant="danger" icon="trash-outline" onPress={onDelete} loading={remove.isPending} />}
    </>
  );
}
