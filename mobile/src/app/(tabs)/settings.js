import { useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { toCents } from '@ft/shared';
import { Body, Button, Card, ErrorText, Field, IconButton, Label, Screen, Segmented, Title, ToggleRow } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useFeePresets, useHousehold, useInvites, useSummary, api } from '../../lib/queries';
import { useOutbox } from '../../lib/outbox';
import { WIDGET_SHOW_BALANCE_KEY, pushWidget } from '../../lib/background';
import * as Shortcuts from '../../../modules/wallet-shortcuts';
import { SmartFeatures } from '../../components/SmartFeatures';
import { queryClient } from '../../lib/queryClient';
import { API_URL } from '../../lib/config';
import { formatPHP } from '../../lib/format';
import { useTheme, space } from '../../theme';

export default function Settings() {
  const { user, signOut } = useAuth();
  const isOwner = user?.role === 'owner';
  const outbox = useOutbox();

  const confirmSignOut = () => {
    if (!outbox.length) return signOut();
    Alert.alert(
      'Entries not synced yet',
      `${outbox.length} saved offline ${outbox.length === 1 ? 'entry' : 'entries'} will be lost if you sign out now.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out anyway', style: 'destructive', onPress: signOut }],
    );
  };

  return (
    <Screen>
      <Title>Settings</Title>
      <SmartFeatures />
      <PhoneShortcuts />
      <Household isOwner={isOwner} />
      {isOwner && <Invites />}
      <FeePresets isOwner={isOwner} />
      <Card>
        <Label>Account</Label>
        <Body>{user?.display_name}</Body>
        <Body muted>{user?.email}</Body>
        <Button title="Sign out" variant="secondary" icon="log-out-outline" onPress={confirmSignOut} style={{ marginTop: space.sm }} />
        <Button
          title="Sign out on all devices"
          variant="danger"
          onPress={() => Alert.alert('Sign out everywhere?', 'Use this if a phone was lost. You will need to sign in again.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out all', style: 'destructive', onPress: async () => { await api.post('/auth/logout-all').catch(() => {}); signOut(); } },
          ])}
        />
      </Card>
      <Body muted style={{ fontSize: 12, textAlign: 'center' }}>Server: {API_URL}</Body>
    </Screen>
  );
}

function PhoneShortcuts() {
  const [showBalance, setShowBalance] = useState(true);
  const [note, setNote] = useState(null);
  const summary = useSummary();
  const household = useHousehold();
  const { isOwner } = useAuth();
  const ownerName = household.data?.members.find((m) => m.role === 'owner')?.display_name;

  useEffect(() => {
    SecureStore.getItemAsync(WIDGET_SHOW_BALANCE_KEY).then((v) => setShowBalance(v !== 'false'));
  }, []);

  if (!Shortcuts.isAvailable) {
    return (
      <Card>
        <Label>Phone shortcuts</Label>
        <Body muted>The widget, quick settings tile and app icon shortcuts work in the installed app, not in Expo Go. Double-tap on Home still works here.</Body>
      </Card>
    );
  }

  async function addTile() {
    const r = await Shortcuts.requestAddTile();
    setNote({
      [Shortcuts.TILE_RESULT.ADDED]: 'Tile added. Pull down your notification panel to use it.',
      [Shortcuts.TILE_RESULT.ALREADY_ADDED]: 'The tile is already in your quick settings.',
      [Shortcuts.TILE_RESULT.NOT_ADDED]: 'Not added.',
    }[r] ?? 'Your phone did not allow adding it automatically. Pull down the notification panel twice, tap the pencil (edit) icon, and drag "Add transaction" into your tiles.');
  }

  function addWidget() {
    const ok = Shortcuts.requestPinWidget();
    setNote(ok
      ? 'Follow the prompt to place the widget.'
      : 'Long-press an empty spot on your home screen → Widgets → Finance Tracker → "Wallet balance".');
  }

  return (
    <Card>
      <Label>Phone shortcuts</Label>
      <Body muted>
        Quick ways to log a transaction: double-tap on Home or Activity, long-press the app icon (Add expense / Add income / Transfer),
        the quick settings tile, or the home-screen widget.
      </Body>
      <Button title="Add tile to quick settings" variant="secondary" icon="grid-outline" onPress={addTile} />
      <Button title="Add widget to home screen" variant="secondary" icon="apps-outline" onPress={addWidget} />
      <ToggleRow
        label="Show balance on widget"
        hint="Turn off to show ₱ •••••• instead"
        value={showBalance}
        onValueChange={async (v) => {
          setShowBalance(v);
          await SecureStore.setItemAsync(WIDGET_SHOW_BALANCE_KEY, v ? 'true' : 'false');
          await pushWidget(summary.data, ownerName, isOwner);
        }}
      />
      {note && <Body muted style={{ fontSize: 13 }}>{note}</Body>}
    </Card>
  );
}

function Household({ isOwner }) {
  const q = useHousehold();
  const t = useTheme();
  return (
    <Card>
      <Label>Wallet access</Label>
      <Body style={{ fontWeight: '700', fontSize: 17 }}>{q.data?.household.name ?? '…'}</Body>
      {q.data?.members.map((m) => (
        <View key={m.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Body>{m.display_name}</Body>
          <Text style={{ color: t.muted }}>{m.role === 'owner' ? 'Owner' : 'Partner (view + log)'}</Text>
        </View>
      ))}
      {!isOwner && <Body muted style={{ fontSize: 13 }}>You can view this wallet and log entries. Only the owner can change accounts and settings.</Body>}
      <ErrorText error={q.error} />
    </Card>
  );
}

function Invites() {
  const t = useTheme();
  const q = useInvites(true);
  const create = useMutation({
    mutationFn: () => api.post('/household/invites'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  const cancel = useMutation({
    mutationFn: (id) => api.del(`/household/invites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  const share = (code) =>
    Share.share({ message: `View my wallet in Finance Tracker: open the app, tap "Create account" → "Partner", and enter code ${code}` });

  return (
    <Card>
      <Label>Invite partner</Label>
      <Body muted>Let your partner see your wallet (except private accounts) and log entries. Create a code and send it to them: it works once and expires in 7 days.</Body>
      {(q.data ?? []).map((inv) => (
        <View key={inv.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text selectable style={{ flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: 2, color: t.text }}>{inv.code}</Text>
          <IconButton icon="share-social-outline" label="Share code" onPress={() => share(inv.code)} />
          <IconButton icon="close-circle-outline" label="Cancel code" color={t.danger} onPress={() => cancel.mutate(inv.id)} />
        </View>
      ))}
      <ErrorText error={create.error ?? q.error} />
      <Button title="Create invite code" variant="secondary" icon="person-add-outline" onPress={() => create.mutate()} loading={create.isPending} />
    </Card>
  );
}

function FeePresets({ isOwner }) {
  const t = useTheme();
  const q = useFeePresets();
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [paidBy, setPaidBy] = useState('sender');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['feePresets'] });
  const add = useMutation({ mutationFn: (body) => api.post('/fee-presets', body), onSuccess: () => { setName(''); setFee(''); refresh(); } });
  const remove = useMutation({ mutationFn: (id) => api.del(`/fee-presets/${id}`), onSuccess: refresh });

  return (
    <Card>
      <Label>Transfer fee presets</Label>
      <Body muted>Quick picks when logging a transfer. The app also remembers the last fee you used between two accounts.</Body>
      {(q.data ?? []).map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Body style={{ flex: 1 }}>{p.name} <Body muted>· {formatPHP(p.fee_cents)} · {p.fee_paid_by === 'sender' ? 'sender pays' : 'receiver pays'}</Body></Body>
          {isOwner && <IconButton icon="trash-outline" label={`Delete ${p.name}`} color={t.danger} onPress={() => remove.mutate(p.id)} />}
        </View>
      ))}
      {isOwner && (<>
      <Field value={name} onChangeText={setName} placeholder="Name, e.g. GCash to BPI" maxLength={40} />
      <Field value={fee} onChangeText={(v) => setFee(v.replace(/[^0-9.,]/g, ''))} placeholder="Fee ₱" keyboardType="decimal-pad" />
      <Segmented value={paidBy} onChange={setPaidBy} options={[{ value: 'sender', label: 'Sender pays' }, { value: 'receiver', label: 'Receiver pays' }]} />
      <ErrorText error={add.error} />
      <Button
        title="Add preset"
        variant="secondary"
        icon="add"
        loading={add.isPending}
        disabled={!name.trim() || toCents(fee || 'x') === null}
        onPress={() => add.mutate({ name: name.trim(), fee_cents: toCents(fee), fee_paid_by: paidBy })}
      />
      </>)}
    </Card>
  );
}
