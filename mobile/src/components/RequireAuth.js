import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth';

/** Sends signed-out users to sign in (e.g. a shortcut opening /add after logout). */
export function RequireAuth({ children }) {
  const { signedIn, loading } = useAuth();
  if (loading) return null;
  if (!signedIn) return <Redirect href="/sign-in" />;
  return children;
}
