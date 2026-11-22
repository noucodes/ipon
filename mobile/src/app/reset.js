// Reset my data: start the wallet over. Requires typing RESET.
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RequireAuth } from '../components/RequireAuth';
import { Body, Button, Card, ErrorText, Field, Ionicons, Label } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/queries';
import { queryClient } from '../lib/queryClient';
import { clearOutbox } from '../lib/outbox';
import { cancelReminders } from '../lib/reminders';
import { detection, updateWidget } from '../../modules/wallet-shortcuts';
import { useTheme, space } from '../theme';

export default function ResetScreen() {
  const t = useTheme();
  const router = useRouter();
  const { isOwner, setOnboarded } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function reset() {
    setError(null);
    setBusy(true);
    try {
      await api.post('/household/reset', { confirm: 'RESET' });
      // Clear what this phone still holds about the old data
      await clearOutbox();
      await cancelReminders().catch(() => {});
      detection.clear();
      updateWidget({ title: 'Net worth', amount: '₱0.00', subtitle: 'Reset' });
      await setOnboarded(false).catch(() => {});
      await queryClient.invalidateQueries();
      router.replace('/setup');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) {
    return <RequireAuth><View style={{ padding: space.lg }}><Body>Only the wallet owner can reset data.</Body></View></RequireAuth>;
  }

  return (
    <RequireAuth>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 48, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <Ionicons name="warning-outline" size={44} color={t.danger} />
          <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>Reset my data</Text>
          <Body muted style={{ textAlign: 'center' }}>Start your wallet over from zero. This can't be undone.</Body>
        </View>

        <Card>
          <Label>Will be deleted</Label>
          {['All accounts and balances', 'All transactions and transfers', 'Loans, utang and people', 'Income, bills and reminders', 'Payslips and deductions'].map((s) => (
            <Body key={s}>• {s}</Body>
          ))}
        </Card>
        <Card>
          <Label>Will be kept</Label>
          {['Your login and your partner’s access', 'Categories and transfer fee presets', 'App settings on this phone'].map((s) => (
            <Body key={s}>• {s}</Body>
          ))}
        </Card>

        <Field label='Type "RESET" to confirm' value={text} onChangeText={setText} autoCapitalize="characters" placeholder="RESET" />
        <ErrorText error={error} />
        <Button title="Delete everything and start over" variant="danger" icon="trash-outline" onPress={reset} loading={busy} disabled={text.trim() !== 'RESET'} />
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </RequireAuth>
  );
}
