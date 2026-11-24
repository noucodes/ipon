import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { toCents, todayInManila, addDays, balanceEffects } from '@ft/shared';
import { Body, Button, Chip, ChipRow, ErrorText, Field, Label, Loading, Segmented, Empty } from './ui';
import { useAccounts, useCategories, useFeePresets, useFeeSuggestion } from '../lib/queries';
import { ACCOUNT_TYPE_ICONS, centsToInput, formatPHP, friendlyDate } from '../lib/format';
import { addTransaction, deleteTransaction, editTransaction } from '../lib/outbox';
import { useTheme, space, radius } from '../theme';

const LAST_ACCOUNT_KEY = 'last_account_id';

/**
 * Add or edit a transaction.
 * `initial` = existing transaction (edit mode) or undefined (quick add).
 * `initialType` = 'expense' | 'income' | 'transfer' for quick add.
 */
export function TransactionForm({ initial, initialType = 'expense', onDone }) {
  const t = useTheme();
  const editing = Boolean(initial);
  const readOnly = editing && !initial.can_edit;

  const accountsQ = useAccounts({ includeArchived: editing });
  const categoriesQ = useCategories();
  const presetsQ = useFeePresets();

  const [type, setType] = useState(initial?.type ?? initialType);
  const [amount, setAmount] = useState(centsToInput(initial?.amount_cents));
  const [accountId, setAccountId] = useState(initial?.account_id ?? null);
  const [toAccountId, setToAccountId] = useState(initial?.to_account_id ?? null);
  const [fee, setFee] = useState(initial?.fee_cents ? centsToInput(initial.fee_cents) : '');
  const [feePaidBy, setFeePaidBy] = useState(initial?.fee_paid_by ?? 'sender');
  const feeTouched = useRef(editing);
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.occurred_on ?? todayInManila());
  const [showPicker, setShowPicker] = useState(false);
  const [formError, setFormError] = useState(null);

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const usable = accounts.filter((a) => !a.archived || a.id === accountId || a.id === toAccountId);

  // Quick add: pre-select the account used last time.
  useEffect(() => {
    if (editing || accountId || !accounts.length) return;
    SecureStore.getItemAsync(LAST_ACCOUNT_KEY).then((last) => {
      const found = accounts.find((a) => a.id === last && !a.archived);
      setAccountId(found?.id ?? accounts[0].id);
    });
  }, [accounts, accountId, editing]);

  // Pre-fill the fee used last time on this route, until the user types their own.
  const suggestion = useFeeSuggestion(type === 'transfer' ? accountId : null, toAccountId);
  useEffect(() => {
    if (feeTouched.current || type !== 'transfer' || suggestion.data === undefined) return;
    setFee(suggestion.data ? centsToInput(suggestion.data.fee_cents) : '');
    setFeePaidBy(suggestion.data?.fee_paid_by ?? 'sender');
  }, [suggestion.data, type]);

  const categories = (categoriesQ.data ?? []).filter((c) => c.kind === type && !c.archived);


  const amountCents = toCents(amount || '0');
  const feeCents = type === 'transfer' ? toCents(fee || '0') : 0;

  // Live preview of what happens to each balance
  const preview = useMemo(() => {
    if (!amountCents || amountCents <= 0 || !accountId) return null;
    if (type === 'transfer' && (!toAccountId || feeCents === null)) return null;
    const fx = balanceEffects({ type, amount_cents: amountCents, account_id: accountId, to_account_id: toAccountId, fee_cents: feeCents, fee_paid_by: feePaidBy });
    return Object.entries(fx).map(([id, delta]) => ({ name: accounts.find((a) => a.id === id)?.name ?? '?', delta }));
  }, [type, amountCents, accountId, toAccountId, feeCents, feePaidBy, accounts]);

  function changeType(next) {
    if (next === type) return;
    setType(next);
    setCategoryId(null);
    if (next !== 'transfer') setToAccountId(null);
  }

  async function onSave() {
    setFormError(null);
    if (!amountCents || amountCents <= 0) return setFormError({ message: 'Enter an amount' });
    if (!accountId) return setFormError({ message: 'Choose an account' });
    if (type === 'transfer') {
      if (!toAccountId) return setFormError({ message: 'Choose where the money is going' });
      if (feeCents === null || feeCents < 0) return setFormError({ message: 'Fee is not a valid amount' });
    }
    const body = {
      type,
      amount_cents: amountCents,
      account_id: accountId,
      to_account_id: type === 'transfer' ? toAccountId : null,
      fee_cents: feeCents,
      fee_paid_by: type === 'transfer' ? feePaidBy : null,
      category_id: type === 'transfer' ? null : categoryId,
      occurred_on: date,
      note: note.trim() || null,
    };
    if (type === 'transfer' && toAccountId === accountId) return setFormError({ message: "You can't transfer to the same account" });
    if (type === 'transfer' && feePaidBy === 'receiver' && feeCents > amountCents) return setFormError({ message: 'Fee is larger than the amount received' });
    if (type === 'income' && accounts.find((a) => a.id === accountId)?.type === 'person') {
      return setFormError({ message: 'To record a repayment, use a transfer from the person to your account' });
    }
    // Saved on the phone straight away; it syncs in the background.
    try {
      if (editing) {
        await editTransaction(initial, body);
      } else {
        await addTransaction({ ...body, client_id: Crypto.randomUUID() }, {
          account_name: accounts.find((a) => a.id === accountId)?.name,
          to_account_name: accounts.find((a) => a.id === toAccountId)?.name,
          category_name: categories.find((c) => c.id === categoryId)?.name,
        });
      }
      SecureStore.setItemAsync(LAST_ACCOUNT_KEY, accountId);
      onDone?.();
    } catch (err) {
      setFormError(err);
    }
  }

  function onDelete() {
    Alert.alert('Delete transaction?', 'Balances will be updated.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTransaction(initial);
            onDone?.();
          } catch (err) {
            setFormError(err);
          }
        },
      },
    ]);
  }

  if (accountsQ.isPending) return <Loading />;
  if (accountsQ.error) return <ErrorText error={accountsQ.error} />;
  if (!accounts.length) {
    return <Empty icon="wallet-outline" title="Add an account first" hint="Go to the Accounts tab and add your bank, e-wallet or cash on hand." />;
  }

  const typeColor = t[type];
  const accountChips = (selected, onSelect, exclude) => usable
    .filter((a) => a.id !== exclude)
    .map((a) => (
      <Chip
        key={a.id}
        label={a.name}
        icon={a.is_private ? 'lock-closed' : ACCOUNT_TYPE_ICONS[a.type]}
        selected={selected === a.id}
        onPress={() => !readOnly && onSelect(a.id)}
        color={typeColor}
      />
    ));

  return (
    <View style={{ gap: space.lg }}>
      {readOnly && (
        <Body muted>{initial.account_name === 'Private account' || initial.to_account_name === 'Private account' ? 'This involves a private account, so it is read-only.' : 'Only the person who logged this (or the wallet owner) can change it.'}</Body>
      )}

      <Segmented
        value={type}
        onChange={(v) => !readOnly && changeType(v)}
        options={[
          { value: 'expense', label: 'Expense', color: t.expense },
          { value: 'income', label: 'Income', color: t.income },
          { value: 'transfer', label: 'Transfer', color: t.transfer },
        ]}
      />

      {/* Amount */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Text style={{ fontSize: 34, fontWeight: '700', color: typeColor }}>₱</Text>
        <TextInput
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))}
          placeholder="0"
          placeholderTextColor={t.muted}
          keyboardType="decimal-pad"
          autoFocus={!editing}
          editable={!readOnly}
          accessibilityLabel="Amount"
          style={{ fontSize: 44, fontWeight: '700', color: t.text, minWidth: 120, textAlign: 'center', fontVariant: ['tabular-nums'] }}
        />
      </View>

      {/* Accounts */}
      <View style={{ gap: space.sm }}>
        <Label>{type === 'transfer' ? 'From' : type === 'income' ? 'Into' : 'Paid from'}</Label>
        <ChipRow>{accountChips(accountId, (id) => { setAccountId(id); if (id === toAccountId) setToAccountId(null); feeTouched.current = editing; })}</ChipRow>
      </View>

      {type === 'transfer' && (
        <>
          <View style={{ gap: space.sm }}>
            <Label>To</Label>
            <ChipRow>{accountChips(toAccountId, (id) => { setToAccountId(id); feeTouched.current = editing; }, accountId)}</ChipRow>
          </View>

          <View style={{ gap: space.sm, backgroundColor: t.chip, padding: space.md, borderRadius: radius.md }}>
            <Label>Transfer fee</Label>
            <ChipRow>
              <Chip label="No fee" selected={!fee || toCents(fee) === 0} onPress={() => { feeTouched.current = true; setFee(''); }} />
              {(presetsQ.data ?? []).filter((p) => p.fee_cents > 0).map((p) => (
                <Chip
                  key={p.id}
                  label={`${p.name} ${formatPHP(p.fee_cents)}`}
                  selected={toCents(fee || '0') === p.fee_cents}
                  onPress={() => { feeTouched.current = true; setFee(centsToInput(p.fee_cents)); setFeePaidBy(p.fee_paid_by); }}
                />
              ))}
            </ChipRow>
            <Field
              value={fee}
              onChangeText={(v) => { feeTouched.current = true; setFee(v.replace(/[^0-9.,]/g, '')); }}
              placeholder="₱0.00"
              keyboardType="decimal-pad"
              editable={!readOnly}
              accessibilityLabel="Fee amount"
            />
            {suggestion.data && !feeTouched.current && (
              <Body muted style={{ fontSize: 13 }}>Same fee as your last transfer on this route</Body>
            )}
            <Label style={{ marginTop: 4 }}>Who pays the fee</Label>
            <Segmented
              value={feePaidBy}
              onChange={(v) => { feeTouched.current = true; setFeePaidBy(v); }}
              options={[{ value: 'sender', label: 'Sender (extra)' }, { value: 'receiver', label: 'Receiver (less)' }]}
            />
          </View>
        </>
      )}

      {/* Category */}
      {type !== 'transfer' && (
        <View style={{ gap: space.sm }}>
          <Label>Category</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={categoryId === c.id}
                onPress={() => !readOnly && setCategoryId(categoryId === c.id ? null : c.id)}
                color={typeColor}
              />
            ))}
          </View>
        </View>
      )}

      {/* Date */}
      <View style={{ gap: space.sm }}>
        <Label>Date</Label>
        <ChipRow>
          <Chip label="Today" selected={date === todayInManila()} onPress={() => setDate(todayInManila())} />
          <Chip label="Yesterday" selected={date === addDays(todayInManila(), -1)} onPress={() => setDate(addDays(todayInManila(), -1))} />
          <Chip
            icon="calendar-outline"
            label={date !== todayInManila() && date !== addDays(todayInManila(), -1) ? friendlyDate(date) : 'Pick date'}
            selected={date !== todayInManila() && date !== addDays(todayInManila(), -1)}
            onPress={() => !readOnly && setShowPicker(true)}
          />
        </ChipRow>
        {showPicker && (
          <DateTimePicker
            value={new Date(`${date}T12:00:00`)}
            mode="date"
            maximumDate={new Date()}
            onChange={(event, picked) => {
              setShowPicker(Platform.OS === 'ios');
              if (event.type === 'set' && picked) {
                const y = picked.getFullYear();
                const m = String(picked.getMonth() + 1).padStart(2, '0');
                const d = String(picked.getDate()).padStart(2, '0');
                setDate(`${y}-${m}-${d}`);
              }
            }}
          />
        )}
      </View>

      <Field label="Note" value={note} onChangeText={setNote} placeholder="e.g. Jollibee lunch" maxLength={500} editable={!readOnly} />

      {preview && (
        <View style={{ gap: 2 }}>
          {preview.map((p) => (
            <Body key={p.name} muted style={{ fontSize: 13 }}>
              {p.name}: {p.delta < 0 ? '−' : '+'}{formatPHP(Math.abs(p.delta))}
            </Body>
          ))}
        </View>
      )}

      <ErrorText error={formError} />

      {!readOnly && (
        <Button title={editing ? 'Save changes' : 'Save'} onPress={onSave} />
      )}
      {editing && !readOnly && (
        <Button title="Delete" variant="danger" icon="trash-outline" onPress={onDelete} />
      )}
    </View>
  );
}
