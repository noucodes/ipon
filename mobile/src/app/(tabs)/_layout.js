import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme';

const icon = (name) => ({ color, focused }) => <Ionicons name={focused ? name : `${name}-outline`} size={24} color={color} />;

export default function TabsLayout() {
  const { signedIn, loading } = useAuth();
  const t = useTheme();
  if (loading) return null;
  if (!signedIn) return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('list') }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: icon('wallet') }} />
      <Tabs.Screen name="plan" options={{ title: 'Income & Bills', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
