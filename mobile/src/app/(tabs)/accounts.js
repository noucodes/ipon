import { useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MONEY_ACCOUNT_TYPES } from '@ft/shared';
import { Body, Button, Card, Empty, ErrorText, IconButton, Ionicons, Label, Loading, Money, Screen, Title, ToggleRow } from '../../components/ui';
import { useAccounts } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, friendlyDate } from '../../lib/format';
import { useTheme, space } from '../../theme';

export default function Accounts() {
  const t = useTheme();
  const router = useRouter();
  const { isOwner } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const q = useAccounts({ includeArchived: showArchived });
  const accounts = q.data ?? [];
  const total = accounts.filter((a) => !a.archived).reduce((n, a) => n + a.balance_cents, 0);
  const people = accounts.filter((a) => a.type === 'person');

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} />}>
      <Title right={isOwner && <IconButton icon="add-circle" label="Add account" onPress={() => router.push('/account/new')} />}>Accounts</Title>
      {q.isPending && <Loading />}
      <ErrorText error={q.error} />

      {q.data && accounts.length === 0 && (
        <Empty
          icon="wallet-outline"
          title="No accounts yet"
          hint={isOwner ? 'Add your banks (BDO, BPI…), digital banks and e-wallets (GCash, Maya…) and cash on hand.' : 'Nothing to show yet.'}
          action={isOwner && <Button title="Add account" icon="add" onPress={() => router.push('/account/new')} />}
        />
      )}

      {accounts.length > 0 && (
        <Card>
          <Label>{isOwner ? 'Total' : 'Total you can see'}</Label>
          <Money cents={total} size={28} weight="800" />
        </Card>
      )}

      {MONEY_ACCOUNT_TYPES.map((type) => {
        const group = accounts.filter((a) => a.type === type);
        if (!group.length) return null;
        const sum = group.filter((a) => !a.archived).reduce((n, a) => n + a.balance_cents, 0);
        return (
          <Card key={type}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Ionicons name={ACCOUNT_TYPE_ICONS[type]} size={18} color={t.muted} />
              <Label style={{ flex: 1 }}>{ACCOUNT_TYPE_LABELS[type]}</Label>
              <Money cents={sum} size={14} />
            </View>
            {group.map((a) => (
              <Pressable
                key={a.id}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: space.sm, opacity: a.archived ? 0.5 : pressed ? 0.6 : 1 })}
                onPress={() => router.push(`/account/${a.id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
                    {a.name}{a.is_private ? '  ' : ''}{a.is_private && <Ionicons name="lock-closed" size={13} color={t.muted} />}
                  </Text>
                  {(a.is_private || a.archived) && <Body muted style={{ fontSize: 13 }}>{[a.is_private && 'Private', a.archived && 'Archived'].filter(Boolean).join(' · ')}</Body>}
                </View>
                <Money cents={a.balance_cents} size={16} />
              </Pressable>
            ))}
          </Card>
        );
      })}

      {isOwner && (
        <Card onPress={() => router.push('/loan/new')} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Ionicons name="receipt-outline" size={22} color={t.text} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>Set up a loan / pay later</Body>
            <Body muted style={{ fontSize: 13 }}>BillEase, SPayLater, GGives, Atome, Home Credit…</Body>
          </View>
          <Ionicons name="chevron-forward" size={20} color={t.muted} />
        </Card>
      )}

      <PeopleCard people={people} isOwner={isOwner} />

      {accounts.length > 0 && (
        <ToggleRow label="Show archived accounts" value={showArchived} onValueChange={setShowArchived} />
      )}
    </Screen>
  );
}

/** People you lend to or borrow from. Positive = they owe you, negative = you owe them. */
function PeopleCard({ people, isOwner }) {
  const t = useTheme();
  const router = useRouter();
  const active = people.filter((p) => !p.archived);
  const owed = active.filter((p) => p.balance_cents > 0).reduce((n, p) => n + p.balance_cents, 0);
  const owe = active.filter((p) => p.balance_cents < 0).reduce((n, p) => n + p.balance_cents, 0);

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name="people-outline" size={18} color={t.muted} />
        <Label style={{ flex: 1 }}>People (utang)</Label>
        {isOwner && <IconButton icon="person-add-outline" label="Add person" onPress={() => router.push('/account/new?type=person')} />}
      </View>
      {people.length === 0 ? (
        <Body muted style={{ fontSize: 13 }}>
          Lent money or let someone use your card? Add the person, then use Transfer (e.g. Wallet → Juan). Repayments go the other way (Juan → GCash).
        </Body>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}><Body muted style={{ fontSize: 12 }}>Owed to you</Body><Money cents={owed} kind="income" /></View>
            <View style={{ flex: 1 }}><Body muted style={{ fontSize: 12 }}>You owe</Body><Money cents={Math.abs(owe)} kind={owe ? 'expense' : undefined} /></View>
          </View>
          {people.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/account/${p.id}`)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: space.sm, opacity: p.archived ? 0.5 : pressed ? 0.6 : 1 })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
                  {p.name}{p.is_private ? '  ' : ''}{p.is_private && <Ionicons name="lock-closed" size={13} color={t.muted} />}
                </Text>
                <Body muted style={{ fontSize: 13 }}>
                  {p.balance_cents > 0 ? 'owes you' : p.balance_cents < 0 ? 'you owe' : 'settled'}
                  {p.due_date && p.balance_cents !== 0 ? ` · due ${friendlyDate(p.due_date)}` : ''}
                </Body>
              </View>
              <Money cents={Math.abs(p.balance_cents)} kind={p.balance_cents > 0 ? 'income' : p.balance_cents < 0 ? 'expense' : undefined} size={16} />
            </Pressable>
          ))}
        </>
      )}
    </Card>
  );
}
