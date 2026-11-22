import { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { IconButton, Row, Screen, Section, Title } from '../../components/ui';
import { SmartFeatures } from '../../components/SmartFeatures';
import { useAuth } from '../../lib/auth';
import { useHousehold, useInvites, api } from '../../lib/queries';
import { useOutbox } from '../../lib/outbox';
import { queryClient } from '../../lib/queryClient';
import { API_URL } from '../../lib/config';
import * as Shortcuts from '../../../modules/wallet-shortcuts';
import { useTheme, space, radius } from '../../theme';

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const { user, signOut, isOwner } = useAuth();
  const outbox = useOutbox();

  const confirmSignOut = () => {
    if (!outbox.length) return signOut();
    Alert.alert(
      'Entries not synced yet',
      `${outbox.length} saved offline ${outbox.length === 1 ? 'entry' : 'entries'} will be lost if you sign out now.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out anyway', style: 'destructive', onPress: signOut }],
    );
  };

  const signOutEverywhere = () => Alert.alert('Sign out everywhere?', 'Use this if a phone was lost. You will need to sign in again.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out all', style: 'destructive', onPress: async () => { await api.post('/auth/logout-all').catch(() => {}); signOut(); } },
  ]);

  return (
    <Screen contentStyle={{ gap: space.xl }}>
      <Title>Settings</Title>

      {/* Profile */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.card, borderRadius: radius.lg, padding: space.lg }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.hero, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: t.heroText }}>{(user?.display_name ?? '?').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: t.text }} numberOfLines={1}>{user?.display_name}</Text>
          <Text style={{ fontSize: 13, color: t.muted }} numberOfLines={1}>{user?.email}</Text>
        </View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: t.muted }}>{isOwner ? 'Owner' : 'Partner'}</Text>
      </View>

      {isOwner && (
        <Section>
          <Row icon="rocket-outline" iconColor="#0B6B4F" label="Set up my finances" hint="Banks, cards, loans, utang, salary & bills" onPress={() => router.push('/setup')} />
          <Row icon="document-text-outline" iconColor="#2F9E55" label="Payslips & deductions" hint="SSS, PhilHealth, Pag-IBIG, tax, lates" onPress={() => router.push('/payslips')} />
        </Section>
      )}

      <SmartFeatures />
      <PhoneShortcuts />
      <WalletSection isOwner={isOwner} />

      <Section title="Account">
        <Row icon="log-out-outline" iconColor="#6E6E78" label="Sign out" onPress={confirmSignOut} chevron={false} />
        <Row icon="phone-portrait-outline" danger label="Sign out on all devices" hint="If a phone was lost" onPress={signOutEverywhere} chevron={false} />
        {isOwner && <Row icon="refresh-circle-outline" danger label="Reset my data" hint="Delete everything and start over" onPress={() => router.push('/reset')} />}
      </Section>

      {__DEV__ && <Text style={{ fontSize: 11, color: t.muted, textAlign: 'center' }}>Server: {API_URL}</Text>}
    </Screen>
  );
}

function PhoneShortcuts() {
  const [note, setNote] = useState(null);

  if (!Shortcuts.isAvailable) {
    return (
      <Section title="Phone shortcuts" footer="The widget, tile and app icon shortcuts work in the installed app, not in Expo Go.">
        <Row icon="hand-left-outline" iconColor="#4F63E8" label="Double-tap to add" hint="On Home or Activity" />
      </Section>
    );
  }

  async function addTile() {
    const r = await Shortcuts.requestAddTile();
    setNote({
      [Shortcuts.TILE_RESULT.ADDED]: 'Tile added. Pull down your notification panel to use it.',
      [Shortcuts.TILE_RESULT.ALREADY_ADDED]: 'The tile is already in your quick settings.',
      [Shortcuts.TILE_RESULT.NOT_ADDED]: 'Not added.',
    }[r] ?? 'Pull down the notification panel twice, tap the pencil (edit) icon, and drag "Add transaction" into your tiles.');
  }

  function addWidget() {
    setNote(Shortcuts.requestPinWidget()
      ? 'Follow the prompt to place the widget.'
      : 'Long-press an empty spot on your home screen → Widgets → Ipon → "Quick add".');
  }

  return (
    <Section
      title="Phone shortcuts"
      footer={note ?? 'You can also double-tap on Home, or long-press the app icon for Add expense / Add income / Transfer.'}
    >
      <Row icon="grid-outline" iconColor="#4F63E8" label="Add tile to quick settings" hint="Log from the pull-down panel" onPress={addTile} />
      <Row icon="apps-outline" iconColor="#0EA5E9" label="Add widget to home screen" hint="Expense · Income · Transfer buttons" onPress={addWidget} />
    </Section>
  );
}

function WalletSection({ isOwner }) {
  const t = useTheme();
  const router = useRouter();
  const household = useHousehold();
  const invites = useInvites(isOwner);
  const create = useMutation({
    mutationFn: () => api.post('/household/invites'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  const cancel = useMutation({
    mutationFn: (id) => api.del(`/household/invites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
  const share = (code) =>
    Share.share({ message: `View my wallet in Ipon: open the app, tap "Create account" → "Partner", and enter code ${code}` });

  return (
    <Section
      title={household.data?.household.name ? `Wallet · ${household.data.household.name}` : 'Wallet'}
      footer={isOwner
        ? 'Your partner can see your wallet (except private accounts) and log entries. Invite codes work once and expire in 7 days.'
        : 'You can view this wallet and log entries. Only the owner can change accounts and settings.'}
    >
      {(household.data?.members ?? []).map((m) => (
        <Row
          key={m.id}
          icon={m.role === 'owner' ? 'person' : 'people'}
          iconColor={m.role === 'owner' ? '#0B6B4F' : '#F59E0B'}
          label={m.display_name}
          hint={m.role === 'owner' ? 'Owner' : 'Partner · view & log'}
        />
      ))}
      {isOwner && (invites.data ?? []).map((inv) => (
        <Row
          key={inv.id}
          icon="key-outline"
          iconColor="#A855F7"
          label={inv.code}
          hint="Invite code · tap share to send"
          right={(
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="share-social-outline" label="Share code" color={t.text} onPress={() => share(inv.code)} />
              <IconButton icon="close-circle-outline" label="Cancel code" color={t.danger} onPress={() => cancel.mutate(inv.id)} />
            </View>
          )}
        />
      ))}
      {isOwner && (
        <Row icon="person-add-outline" iconColor="#2F9E55" label={create.isPending ? 'Creating…' : 'Invite partner'} onPress={() => create.mutate()} chevron={false} />
      )}
      <Row icon="pricetag-outline" iconColor="#E0533D" label="Transfer fee presets" hint="InstaPay, PESONet…" onPress={() => router.push('/fees')} />
    </Section>
  );
}
