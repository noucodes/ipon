import { useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ACCOUNT_TYPES } from '@ft/shared';
import { Body, Button, Card, Empty, ErrorText, IconButton, Ionicons, Label, Loading, Money, Screen, Title, ToggleRow } from '../../components/ui';
import { useAccounts } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS } from '../../lib/format';
import { useTheme, space } from '../../theme';

export default function Accounts() {
  const t = useTheme();
  const router = useRouter();
  const { isOwner } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const q = useAccounts({ includeArchived: showArchived });
  const accounts = q.data ?? [];
  const total = accounts.filter((a) => !a.archived).reduce((n, a) => n + a.balance_cents, 0);

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

      {ACCOUNT_TYPES.map((type) => {
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

      {accounts.length > 0 && (
        <ToggleRow label="Show archived accounts" value={showArchived} onValueChange={setShowArchived} />
      )}
    </Screen>
  );
}
