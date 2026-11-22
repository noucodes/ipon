import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/auth';

export default function AuthLayout() {
  const { signedIn, loading } = useAuth();
  if (loading) return null;
  if (signedIn) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
