import { AppState } from 'react-native';
import { QueryClient, focusManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WEEK = 7 * 24 * 60 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep data around long enough to be saved to the phone and shown on the next launch.
      gcTime: WEEK,
      // Show what we have and refresh quietly; never wait on the network before showing cached data.
      networkMode: 'offlineFirst',
      retry: (count, err) => err?.status !== 401 && err?.status !== 404 && err?.status !== 0 && count < 2,
    },
  },
});

/**
 * The app's data is saved on the phone, so screens open instantly with the last known
 * numbers and refresh in the background. Bump `buster` if the shape of cached data changes.
 */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'ipon_cache', throttleTime: 1000 });

export const persistOptions = {
  persister,
  maxAge: WEEK,
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] !== 'invites',
  },
};

/** Forget everything saved (sign out). */
export async function clearCache() {
  queryClient.clear();
  await persister.removeClient();
}

// Coming back to the app refreshes anything stale, in the background.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});
