import { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { Body, Button, ErrorText, Field, Screen, Segmented, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { space } from '../../theme';

export default function SignUp() {
  const { register } = useAuth();
  const [mode, setMode] = useState('new'); // 'new' household or 'join' with invite code
  const [form, setForm] = useState({ display_name: '', email: '', password: '', household_name: '', invite_code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await register({
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        password: form.password,
        ...(mode === 'new'
          ? (form.household_name.trim() ? { household_name: form.household_name.trim() } : {})
          : { invite_code: form.invite_code.trim() }),
      });
    } catch (err) {
      setError(err.issues?.length ? { message: err.issues.map((i) => i.message).join('\n') } : err);
    } finally {
      setBusy(false);
    }
  }

  const ready = form.display_name && form.email && form.password.length >= 8 && (mode === 'new' || form.invite_code);

  return (
    <Screen contentStyle={{ paddingTop: 40, gap: space.lg }}>
      <Title>Create account</Title>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[{ value: 'new', label: 'My wallet' }, { value: 'join', label: 'Partner' }]}
      />
      <Body muted>
        {mode === 'new'
          ? "Track your own banks, e-wallets and cash. You can let your partner view it later from Settings."
          : "Enter the code your partner sent you to view their wallet. You'll be able to see it and log entries."}
      </Body>
      {mode === 'join' && (
        <Field label="Invite code" value={form.invite_code} onChangeText={set('invite_code')} autoCapitalize="characters" placeholder="ABCD-2345" />
      )}
      <Field label="Your name" value={form.display_name} onChangeText={set('display_name')} autoComplete="name" />
      <Field label="Email" value={form.email} onChangeText={set('email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password (8+ characters)" value={form.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />
      {mode === 'new' && (
        <Field label="Wallet name (optional)" value={form.household_name} onChangeText={set('household_name')} placeholder="e.g. My wallet" />
      )}
      <ErrorText error={error} />
      <Button title="Create account" onPress={submit} loading={busy} disabled={!ready} />
      <View style={{ alignItems: 'center' }}>
        <Link href="/sign-in"><Body style={{ fontWeight: '700' }}>Already have an account? Sign in</Body></Link>
      </View>
    </Screen>
  );
}
