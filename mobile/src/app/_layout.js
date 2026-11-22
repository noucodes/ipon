import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { AppLock } from '../components/AppLock';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { BackgroundTasks } from '../lib/background';
import { queryClient } from '../lib/queryClient';
import { useTheme } from '../theme';

// Deep links straight to /add (shortcuts, widget) still get the tabs underneath.
export const unstable_settings = { anchor: '(tabs)' };

function RootStack() {
  const t = useTheme();
  const modal = (title) => ({
    presentation: 'modal',
    headerShown: true,
    title,
    headerStyle: { backgroundColor: t.bg },
    headerTintColor: t.text,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: t.bg },
  });
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
        <Stack.Screen name="transaction/[id]" options={modal('Transaction')} />
        <Stack.Screen name="account/[id]" options={modal('Account')} />
        <Stack.Screen name="recurring/[id]" options={modal('Income or bill')} />
        <Stack.Screen name="loan/new" options={modal('Loan / pay later')} />
        <Stack.Screen name="setup" options={modal('Set up your finances')} />
        <Stack.Screen name="fees" options={modal('Transfer fee presets')} />
        <Stack.Screen name="reset" options={modal('Reset my data')} />
        <Stack.Screen name="payslip/new" options={modal('Log pay')} />
        <Stack.Screen name="payslips" options={modal('Payslips & deductions')} />
      </Stack>
    </>
  );
}

/** Tapping a reminder opens the screen in its data.url (e.g. /plan). */
function NotificationTaps() {
  const router = useRouter();
  useEffect(() => {
    const open = (response) => {
      const url = response?.notification?.request?.content?.data?.url;
      if (typeof url === 'string') {
        router.push(url);
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      }
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BackgroundTasks />
          <NotificationTaps />
          <RootStack />
          <AppLock />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
