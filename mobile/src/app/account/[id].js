import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ACCOUNT_TYPES, toCents } from '@ft/shared';
import { RequireAuth } from '../../components/RequireAuth';
import { Body, Button, Chip, ErrorText, Field, Label, Loading, Money, ToggleRow, Card } from '../../components/ui';
import { TransactionRow } from '../../components/TransactionRow';
import { useAccount, useMoneyMutation, useTransactions, api } from '../../lib/queries';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, centsToInput } from '../../lib/format';
import { space } from '../../theme';

// /account/new  -> create
// /account/<id> -> view / edit
export default function AccountScreen() {
  const { id } = useLocalSearchParams();
  const isNew = id === 'new';
  const q = useAccount(isNew ? null : id);

  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {!isNew && q.isPending && <Loading />}
        <ErrorText error={q.error} />
        {(isNew || q.data) && <AccountForm key={q.data?.id ?? 'new'} account={q.data} />}
      </ScrollView>
    </RequireAuth>
  );
}

function AccountForm({ account }) {
  const router = useRouter();
  const isNew = !account;
  const readOnly = !isNew && !account.can_edit;

  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'bank');
  const [isPrivate, setIsPrivate] = useState(account?.is_private ?? false);
  // Credit cards: user types what they owe as a positive number; stored negative.
  const [opening, setOpening] = useState(account ? centsToInput(account.opening_balance_cents) : '');
  const [openingNegative, setOpeningNegative] = useState(account ? account.opening_balance_cents < 0 : false);
  const [error, setError] = useState(null);

  const save = useMoneyMutation((body) => (isNew ? api.post('/accounts', body) : api.patch(`/accounts/${account.id}`, body)));
  const archive = useMoneyMutation((archived) => api.patch(`/accounts/${account.id}`, { archived }));
  const remove = useMoneyMutation(() => api.del(`/accounts/${account.id}`));
  const history = useTransactions({ account_id: account?.id }, { enabled: !isNew });

  const isCard = type === 'credit_card';

  async function onSave() {
    setError(null);
    const cents = toCents(opening || '0');
    if (!name.trim()) return setError({ message: 'Give the account a name' });
    if (cents === null) return setError({ message: 'Starting balance is not a valid amount' });
    const signed = isCard ? -Math.abs(cents) : openingNegative ? -Math.abs(cents) : Math.abs(cents);
    const body = {
      name: name.trim(),
      type,
      opening_balance_cents: signed,
      is_private: isPrivate,
    };
    try {
      await save.mutateAsync(body);
      router.back();
    } catch (err) {
      setError(err);
    }
  }

  function onDelete() {
    Alert.alert(`Delete ${account.name}?`, 'Only possible if it has no transactions. Otherwise archive it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await remove.mutateAsync();
            router.back();
          } catch (err) {
            setError(err);
          }
        },
      },
    ]);
  }

  return (
    <>
      {!isNew && (
        <Card>
          <Label>Current balance</Label>
          <Money cents={account.balance_cents} size={30} weight="800" />
          {account.is_private && <Body muted>Private · hidden from your partner</Body>}
        </Card>
      )}

      {readOnly ? (
        <Body muted>Only the wallet owner can change account settings. You can still log transactions on it.</Body>
      ) : (
        <>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. BDO Savings, GCash, Wallet" maxLength={60} />

          <View style={{ gap: space.sm }}>
            <Label>Type</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {ACCOUNT_TYPES.map((tp) => (
                <Chip key={tp} label={ACCOUNT_TYPE_LABELS[tp]} icon={ACCOUNT_TYPE_ICONS[tp]} selected={type === tp} onPress={() => setType(tp)} />
              ))}
            </View>
          </View>

          <ToggleRow
            label="Private"
            hint="Hidden from your partner, along with its transactions"
            value={isPrivate}
            onValueChange={setIsPrivate}
          />

          <Field
            label={isCard ? 'Amount currently owed' : isNew ? 'Current balance' : 'Starting balance'}
            value={opening}
            onChangeText={(v) => setOpening(v.replace(/[^0-9.,]/g, ''))}
            placeholder="₱0.00"
            keyboardType="decimal-pad"
          />
          {!isCard && (
            <ToggleRow label="Balance is negative (overdrawn)" value={openingNegative} onValueChange={setOpeningNegative} />
          )}
          {!isNew && (
            <Body muted style={{ fontSize: 13 }}>
              The starting balance is what the account had before your first logged transaction. Changing it shifts the current balance.
            </Body>
          )}

          <ErrorText error={error} />
          <Button title={isNew ? 'Add account' : 'Save changes'} onPress={onSave} loading={save.isPending} />

          {!isNew && (
            <>
              <Button
                title={account.archived ? 'Unarchive' : 'Archive'}
                variant="secondary"
                icon="archive-outline"
                loading={archive.isPending}
                onPress={async () => {
                  try { await archive.mutateAsync(!account.archived); router.back(); } catch (err) { setError(err); }
                }}
              />
              <Button title="Delete" variant="danger" icon="trash-outline" onPress={onDelete} loading={remove.isPending} />
            </>
          )}
        </>
      )}

      {!isNew && (
        <Card>
          <Label>Recent activity</Label>
          {(history.data?.pages[0]?.transactions ?? []).slice(0, 15).map((tx) => (
            <TransactionRow key={tx.id} tx={tx} onPress={() => router.push(`/transaction/${tx.id}`)} />
          ))}
          {history.data && !history.data.pages[0].transactions.length && <Body muted>No transactions yet.</Body>}
        </Card>
      )}
    </>
  );
}
