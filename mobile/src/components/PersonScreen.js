// A person you lend to / borrow from (an account of type 'person').
//   balance > 0  -> they owe you      balance < 0 -> you owe them
import { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { toCents, todayInManila } from '@ft/shared';
import { Body, Button, Card, Chip, ChipRow, ErrorText, Field, Ionicons, Label, Segmented, ToggleRow } from './ui';
import { BigAmount } from './BigAmount';
import { TransactionRow } from './TransactionRow';
import { useAuth } from '../lib/auth';
import { useCategories, useMoneyMutation, useTransactions, api } from '../lib/queries';
import { centsToInput, formatPHP, friendlyDate } from '../lib/format';
import { useTheme, space, radius } from '../theme';

export function PersonScreen({ person }) {
  return person ? <PersonDetail person={person} /> : <PersonForm />;
}

function PersonDetail({ person }) {
  const t = useTheme();
  const router = useRouter();
  const { isOwner } = useAuth();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const history = useTransactions({ account_id: person.id });
  const categories = useCategories().data ?? [];
  const writtenOff = categories.find((c) => c.is_system && c.name === 'Written off');
  const writeOff = useMoneyMutation((body) => api.post('/transactions', body));

  const b = person.balance_cents;
  const owesYou = b > 0;
  const youOwe = b < 0;
  const color = owesYou ? t.income : youOwe ? t.expense : t.muted;
  const status = owesYou ? `${person.name} owes you` : youOwe ? `You owe ${person.name}` : 'All settled';

  const go = (path) => router.push(path);
  const lendHref = `/add?type=transfer&to=${person.id}`;    // money goes to them
  const receiveHref = `/add?type=transfer&from=${person.id}`; // money comes from them

  function confirmWriteOff() {
    Alert.alert(
      `Write off ${formatPHP(b)}?`,
      `Use this if ${person.name} won't pay it back. It will count as an expense ("Written off") and their balance goes to zero.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Write off',
          style: 'destructive',
          onPress: async () => {
            try {
              await writeOff.mutateAsync({
                client_id: Crypto.randomUUID(),
                type: 'expense',
                amount_cents: b,
                account_id: person.id,
                category_id: writtenOff?.id ?? null,
                occurred_on: todayInManila(),
                note: `Written off: ${person.name}`,
              });
            } catch (err) {
              setError(err);
            }
          },
        },
      ],
    );
  }

  if (editing) return <PersonForm person={person} onDone={() => setEditing(false)} />;

  return (
    <>
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: space.xl }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>{person.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={{ color: t.muted, fontWeight: '700' }}>{status}</Text>
        <BigAmount cents={Math.abs(b)} size={44} color={color} />
        {person.due_date && b !== 0 && (
          <Body muted style={{ fontSize: 13 }}>Due {friendlyDate(person.due_date)}</Body>
        )}
        {person.note ? <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{person.note}</Body> : null}
        {person.is_private && <Body muted style={{ fontSize: 12 }}>Private · hidden from your partner</Body>}
      </Card>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {youOwe ? (
          <>
            <ActionTile icon="arrow-up" label={`Pay back ${person.name}`} onPress={() => go(lendHref)} />
            <ActionTile icon="arrow-down" label="Borrow more" onPress={() => go(receiveHref)} />
          </>
        ) : (
          <>
            <ActionTile icon="arrow-up" label={owesYou ? 'Lend more' : 'Lend'} onPress={() => go(lendHref)} />
            <ActionTile icon="arrow-down" label={owesYou ? 'Got paid back' : 'Borrow'} onPress={() => go(receiveHref)} />
          </>
        )}
      </View>
      <Body muted style={{ fontSize: 12, textAlign: 'center' }}>
        If {person.name} used your credit card, choose Lend and pick your card as "From".
      </Body>

      {/* Lending apps in your name (BillEase, SPayLater, GGives…) */}
      {isOwner && (
        <Button
          title="Used my lending app"
          variant="secondary"
          icon="receipt-outline"
          onPress={() => go(`/loan/new?for=${person.id}`)}
        />
      )}
      {owesYou && (
        <Button
          title="Paid my lender directly"
          variant="secondary"
          icon="swap-horizontal"
          onPress={() => go(`/add?type=transfer&from=${person.id}`)}
        />
      )}

      <ErrorText error={error} />

      {isOwner && (
        <View style={{ gap: space.sm }}>
          {owesYou && (
            <Button title="Write off (won't be paid back)" variant="secondary" icon="close-circle-outline" onPress={confirmWriteOff} loading={writeOff.isPending} />
          )}
          <Button title="Edit person" variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
        </View>
      )}

      <Card>
        <Label>History</Label>
        {(history.data?.pages[0]?.transactions ?? []).map((tx) => (
          <TransactionRow key={tx.id} tx={tx} onPress={() => router.push(`/transaction/${tx.id}`)} />
        ))}
        {history.data && !history.data.pages[0].transactions.length && <Body muted>No loans or repayments yet.</Body>}
      </Card>
    </>
  );
}

function ActionTile({ icon, label, onPress }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 58, borderRadius: 20, backgroundColor: t.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10, opacity: pressed ? 0.8 : 1 })}
    >
      <Text style={{ color: t.primaryText, fontWeight: '700', fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{label}</Text>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: t.primaryText, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={13} color={t.primaryText} />
      </View>
    </Pressable>
  );
}

/** Add a person, or edit name / due date / note / privacy. */
function PersonForm({ person, onDone }) {
  const router = useRouter();
  const isNew = !person;
  const [name, setName] = useState(person?.name ?? '');
  const [direction, setDirection] = useState(person && person.opening_balance_cents < 0 ? 'i_owe' : 'owes_me');
  const [opening, setOpening] = useState(person ? centsToInput(person.opening_balance_cents) : '');
  const [dueDate, setDueDate] = useState(person?.due_date ?? null);
  const [note, setNote] = useState(person?.note ?? '');
  const [isPrivate, setIsPrivate] = useState(person?.is_private ?? false);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState(null);
  const save = useMoneyMutation((body) => (isNew ? api.post('/accounts', body) : api.patch(`/accounts/${person.id}`, body)));
  const archive = useMoneyMutation(() => api.patch(`/accounts/${person.id}`, { archived: !person.archived }));
  const t = useTheme();

  async function onSave() {
    setError(null);
    const cents = toCents(opening || '0');
    if (!name.trim()) return setError({ message: 'Enter their name' });
    if (cents === null) return setError({ message: 'Amount is not valid' });
    const body = {
      name: name.trim(),
      opening_balance_cents: direction === 'i_owe' ? -Math.abs(cents) : Math.abs(cents),
      due_date: dueDate,
      note: note.trim() || null,
      is_private: isPrivate,
      ...(isNew ? { type: 'person' } : {}),
    };
    try {
      await save.mutateAsync(body);
      if (onDone) onDone();
      else router.back();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Juan, Tita Baby" maxLength={60} />

      <View style={{ gap: space.sm }}>
        <Label>{isNew ? 'Is there already a balance?' : 'Starting balance'}</Label>
        <Segmented value={direction} onChange={setDirection} options={[{ value: 'owes_me', label: 'They owe me' }, { value: 'i_owe', label: 'I owe them' }]} />
        <Field value={opening} onChangeText={(v) => setOpening(v.replace(/[^0-9.,]/g, ''))} placeholder="₱0.00 (leave empty if none)" keyboardType="decimal-pad" />
        <Body muted style={{ fontSize: 12 }}>
          For new loans, use Lend / Borrow on their page instead, so the money comes out of the right account.
        </Body>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>Pay back by (optional)</Label>
        <ChipRow>
          <Chip icon="calendar-outline" label={dueDate ? friendlyDate(dueDate) : 'Pick date'} selected={!!dueDate} onPress={() => setPicker(true)} />
          {dueDate && <Chip label="No date" onPress={() => setDueDate(null)} />}
        </ChipRow>
        <Body muted style={{ fontSize: 12 }}>With reminders on, you'll get a notification the day before.</Body>
        {picker && (
          <DateTimePicker
            value={new Date(`${dueDate ?? todayInManila()}T12:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              setPicker(Platform.OS === 'ios');
              if (event.type === 'set' && picked) {
                setDueDate(`${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`);
              }
            }}
          />
        )}
      </View>

      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. for tuition, will pay on payday" maxLength={300} />
      <ToggleRow label="Private" hint="Hide this person from your partner" value={isPrivate} onValueChange={setIsPrivate} />

      <ErrorText error={error} />
      <Button title={isNew ? 'Add person' : 'Save'} onPress={onSave} loading={save.isPending} />
      {!isNew && (
        <>
          <Button title="Cancel" variant="secondary" onPress={onDone} />
          <Button
            title={person.archived ? 'Unarchive' : 'Archive (hide when settled)'}
            variant="secondary"
            icon="archive-outline"
            loading={archive.isPending}
            onPress={async () => { try { await archive.mutateAsync(); router.back(); } catch (err) { setError(err); } }}
          />
        </>
      )}
      <View style={{ height: 1, backgroundColor: t.border, marginVertical: space.sm, borderRadius: radius.sm }} />
    </>
  );
}
