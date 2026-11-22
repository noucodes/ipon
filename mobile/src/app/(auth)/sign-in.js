import { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { Body, Button, ErrorText, Field, Screen, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { API_URL } from '../../lib/config';
import { space } from '../../theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen contentStyle={{ paddingTop: 60, gap: space.lg }}>
      <Title>Welcome back</Title>
      <Body muted>Sign in to your household's finance tracker.</Body>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={submit} />
      <ErrorText error={error} />
      <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Link href="/sign-up"><Body style={{ fontWeight: '700' }}>New here? Create an account</Body></Link>
        <Body muted style={{ fontSize: 12 }}>Server: {API_URL}</Body>
      </View>
    </Screen>
  );
}
